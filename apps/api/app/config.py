from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "Nebula API"
    environment: str = "development"

    database_url: str = "postgresql+asyncpg://nebula:nebula_dev_password@localhost:5432/nebula"

    jwt_secret: str = "dev-only-secret-change-before-deploying"
    jwt_algorithm: str = "HS256"
    jwt_session_days: int = 1
    jwt_remember_days: int = 30

    cookie_name: str = "nebula_token"
    cookie_secure: bool = False

    cors_origins: str = "http://localhost:4321"

    seed_defaults: bool = True
    seed_demo: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
