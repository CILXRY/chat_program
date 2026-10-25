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


async def test_register_login_me_and_logout(client: AsyncClient) -> None:
    user = await register(client)
    assert user["username"] == "alice"
    assert user["display_name"] == "Alice"

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

    login = await client.post(
        "/api/auth/login",
        json={"username": "ALICE", "password": "nebula123"},
    )
    assert login.status_code == 200
    assert login.json()["username"] == "alice"


async def test_channels_and_messages(client: AsyncClient) -> None:
    await register(client)

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
    await register(client, username="bob", display_name="Bob")
    forbidden = await client.delete(f"/api/messages/{own['id'] + 1}")
    assert forbidden.status_code == 403

    users = await client.get("/api/users")
    assert users.status_code == 200
    assert {user["username"] for user in users.json()} == {"alice", "bob"}


async def test_requires_authentication(client: AsyncClient) -> None:
    assert (await client.get("/api/channels")).status_code == 401
    assert (await client.get("/api/users")).status_code == 401
    assert (await client.get("/api/channels/1/messages")).status_code == 401
    assert (await client.post("/api/channels", json={"name": "x"})).status_code == 401


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert (await client.get("/health")).status_code == 200
