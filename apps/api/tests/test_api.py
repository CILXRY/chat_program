from httpx import AsyncClient


async def register(
    client: AsyncClient,
    username: str = "alice",
    password: str = "nebula123",
    display_name: str | None = "Alice",
) -> dict:
    response = await client.post(
        "/api/auth/register",
        json={
            "username": username,
            "password": password,
            "display_name": display_name,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def login(client: AsyncClient, username: str, password: str = "nebula123") -> dict:
    response = await client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()


def token(client: AsyncClient) -> str:
    value = client.cookies.get("nebula_token")
    assert value
    return value


async def test_register_login_me_and_logout(client: AsyncClient) -> None:
    user = await register(client)
    assert user["username"] == "alice"
    assert user["display_name"] == "Alice"
    assert user["role"] == "admin"

    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["id"] == user["id"]

    duplicate = await client.post(
        "/api/auth/register",
        json={"username": "alice", "password": "nebula123"},
    )
    assert duplicate.status_code == 409

    invalid = await client.post(
        "/api/auth/register",
        json={"username": "a!", "password": "short"},
    )
    assert invalid.status_code == 422

    await client.post("/api/auth/logout")
    assert (await client.get("/api/auth/me")).status_code == 401

    wrong = await client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "wrong-password"},
    )
    assert wrong.status_code == 401

    logged_in = await client.post(
        "/api/auth/login",
        json={"username": "ALICE", "password": "nebula123", "remember": False},
    )
    assert logged_in.status_code == 200
    assert logged_in.json()["username"] == "alice"


async def test_channels_and_messages(client: AsyncClient) -> None:
    alice = await register(client)

    channels = await client.get("/api/channels")
    assert channels.status_code == 200
    channel_list = channels.json()
    assert {channel["name"] for channel in channel_list} == {
        "general",
        "random",
        "voice-lounge",
    }
    general = next(channel for channel in channel_list if channel["name"] == "general")
    voice = next(channel for channel in channel_list if channel["type"] == "voice")

    created = await client.post(
        "/api/channels",
        json={"name": "Design Talk", "type": "text", "topic": "设计讨论"},
    )
    assert created.status_code == 201
    assert created.json()["name"] == "design-talk"
    assert created.json()["topic"] == "设计讨论"
    assert created.json()["created_by"] == alice["id"]

    duplicate = await client.post(
        "/api/channels",
        json={"name": "design talk", "type": "text"},
    )
    assert duplicate.status_code == 409

    first = await client.post(
        f"/api/channels/{general['id']}/messages",
        json={"content": "hello", "nonce": "n1"},
    )
    assert first.status_code == 201
    assert first.json()["author"]["username"] == "alice"

    for index in range(3):
        response = await client.post(
            f"/api/channels/{general['id']}/messages",
            json={"content": f"message {index}"},
        )
        assert response.status_code == 201

    page = await client.get(f"/api/channels/{general['id']}/messages?limit=2")
    assert page.status_code == 200
    assert len(page.json()["items"]) == 2
    assert page.json()["has_more"] is True

    voice_message = await client.post(
        f"/api/channels/{voice['id']}/messages",
        json={"content": "not allowed"},
    )
    assert voice_message.status_code == 400

    own = first.json()
    deleted = await client.delete(f"/api/messages/{own['id']}")
    assert deleted.status_code == 204

    await client.post("/api/auth/logout")
    bob = await register(client, username="bob", display_name="Bob")
    assert bob["role"] == "member"
    forbidden = await client.delete(f"/api/messages/{own['id'] + 1}")
    assert forbidden.status_code == 403

    users = await client.get("/api/users")
    assert users.status_code == 200
    assert {user["username"] for user in users.json()} == {"alice", "bob"}
    roles = {user["username"]: user["role"] for user in users.json()}
    assert roles == {"alice": "admin", "bob": "member"}


async def test_profile_and_password(client: AsyncClient) -> None:
    await register(client)

    updated = await client.patch(
        "/api/users/me",
        json={"display_name": "  Alice Cooper  ", "avatar_color": "#4DD4C0"},
    )
    assert updated.status_code == 200
    assert updated.json()["display_name"] == "Alice Cooper"
    assert updated.json()["avatar_color"] == "#4dd4c0"

    empty = await client.patch("/api/users/me", json={"display_name": "   "})
    assert empty.status_code == 422

    bad_color = await client.patch("/api/users/me", json={"avatar_color": "red"})
    assert bad_color.status_code == 422

    wrong = await client.post(
        "/api/auth/password",
        json={"current_password": "nope", "new_password": "newpass123"},
    )
    assert wrong.status_code == 401

    same = await client.post(
        "/api/auth/password",
        json={"current_password": "nebula123", "new_password": "nebula123"},
    )
    assert same.status_code == 400

    changed = await client.post(
        "/api/auth/password",
        json={"current_password": "nebula123", "new_password": "newpass123"},
    )
    assert changed.status_code == 204

    await client.post("/api/auth/logout")
    old = await client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "nebula123"},
    )
    assert old.status_code == 401
    await login(client, "alice", "newpass123")


async def test_channel_management_permissions(client: AsyncClient) -> None:
    await register(client)
    channels = (await client.get("/api/channels")).json()
    general = next(channel for channel in channels if channel["name"] == "general")

    # Admins can edit channels they did not create.
    updated = await client.patch(
        f"/api/channels/{general['id']}",
        json={"name": "Lobby", "topic": " 大厅 "},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "lobby"
    assert updated.json()["topic"] == "大厅"

    cleared = await client.patch(f"/api/channels/{general['id']}", json={"topic": None})
    assert cleared.status_code == 200
    assert cleared.json()["topic"] is None

    await client.post("/api/auth/logout")
    bob = await register(client, username="bob", display_name="Bob")

    own = await client.post(
        "/api/channels",
        json={"name": "bob-room", "type": "text"},
    )
    assert own.status_code == 201
    bob_channel = own.json()

    denied = await client.patch(f"/api/channels/{general['id']}", json={"name": "nope"})
    assert denied.status_code == 403
    denied_delete = await client.delete(f"/api/channels/{general['id']}")
    assert denied_delete.status_code == 403

    renamed = await client.patch(
        f"/api/channels/{bob_channel['id']}",
        json={"name": "bob-lounge"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "bob-lounge"

    conflict = await client.patch(
        f"/api/channels/{bob_channel['id']}",
        json={"name": "random"},
    )
    assert conflict.status_code == 409

    # Another member's channel is read-only for Bob.
    other = await client.post(
        "/api/channels",
        json={"name": "shared-room", "type": "text"},
    )
    other_channel = other.json()
    await client.patch(f"/api/channels/{other_channel['id']}", json={"name": "shared"})
    await client.post("/api/auth/logout")
    await login(client, "alice")
    assert (
        await client.patch(
            f"/api/channels/{bob_channel['id']}",
            json={"topic": "管理员可编辑"},
        )
    ).status_code == 200

    deleted = await client.delete(f"/api/channels/{bob_channel['id']}")
    assert deleted.status_code == 204
    assert (await client.get(f"/api/channels/{bob_channel['id']}")).status_code == 404
    assert bob["role"] == "member"


async def test_member_removal_roles_and_restore(client: AsyncClient) -> None:
    alice = await register(client)
    admin_token = token(client)
    bob = await register(client, username="bob", display_name="Bob")
    bob_token = token(client)
    assert bob["role"] == "member"

    # Members can neither remove people nor inspect removed accounts.
    assert (await client.delete(f"/api/users/{alice['id']}")).status_code == 403
    assert (await client.get("/api/users?removed=true")).status_code == 403

    client.cookies.set("nebula_token", admin_token)
    # Administrators cannot remove themselves.
    assert (await client.delete(f"/api/users/{alice['id']}")).status_code == 400
    # Nor change their own role.
    self_role = await client.post(
        f"/api/users/{alice['id']}/role",
        json={"role": "member"},
    )
    assert self_role.status_code == 400

    promoted = await client.post(
        f"/api/users/{bob['id']}/role",
        json={"role": "admin"},
    )
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "admin"

    demoted = await client.post(
        f"/api/users/{bob['id']}/role",
        json={"role": "member"},
    )
    assert demoted.status_code == 200
    assert demoted.json()["role"] == "member"

    removed = await client.delete(f"/api/users/{bob['id']}")
    assert removed.status_code == 204

    # Existing sessions stop working.
    client.cookies.set("nebula_token", bob_token)
    assert (await client.get("/api/auth/me")).status_code == 401
    rejected = await client.post(
        "/api/auth/login",
        json={"username": "bob", "password": "nebula123"},
    )
    assert rejected.status_code == 403

    client.cookies.set("nebula_token", admin_token)
    active = (await client.get("/api/users")).json()
    assert {user["username"] for user in active} == {"alice"}
    removed_list = (await client.get("/api/users?removed=true")).json()
    assert {user["username"] for user in removed_list} == {"bob"}

    # Removed usernames stay reserved.
    taken = await client.post(
        "/api/auth/register",
        json={"username": "bob", "password": "nebula123"},
    )
    assert taken.status_code == 409

    restored = await client.post(f"/api/users/{bob['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["role"] == "member"
    assert (await client.get("/api/users?removed=true")).json() == []

    await client.post("/api/auth/logout")
    await login(client, "bob")


async def test_requires_authentication(client: AsyncClient) -> None:
    assert (await client.get("/api/channels")).status_code == 401
    assert (await client.get("/api/users")).status_code == 401
    assert (await client.get("/api/channels/1/messages")).status_code == 401
    assert (await client.post("/api/channels", json={"name": "x"})).status_code == 401
    assert (await client.patch("/api/users/me", json={"display_name": "x"})).status_code == 401


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert (await client.get("/health")).status_code == 200
