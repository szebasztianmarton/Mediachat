"""Passkey (WebAuthn) — kiegészítő, opcionális bejelentkezési mód a jelszó
mellett. Regisztráció csak bejelentkezve indítható; a bejelentkezés
username nélküli (discoverable credential) folyamat: a hitelesítő adat
(credential_id) egyértelműen azonosítja a felhasználót."""

import logging
import secrets

import webauthn
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn.helpers import bytes_to_base64url, options_to_json_dict
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.config import settings
from app.db.models import User, WebauthnCredential
from app.services.cache import CacheService

logger = logging.getLogger(__name__)

CHALLENGE_TTL_SECONDS = 300


class WebauthnServiceError(ValueError):
    pass


class WebauthnService:
    def __init__(self, cache: CacheService) -> None:
        self.cache = cache

    def _reg_challenge_key(self, user_id: str) -> str:
        return f"webauthn:reg:{user_id}"

    def _auth_challenge_key(self, ceremony_id: str) -> str:
        return f"webauthn:auth:{ceremony_id}"

    async def begin_registration(self, db: AsyncSession, user: User) -> dict:
        existing = (
            await db.execute(select(WebauthnCredential).where(WebauthnCredential.user_id == user.id))
        ).scalars().all()
        exclude = [
            PublicKeyCredentialDescriptor(id=webauthn.base64url_to_bytes(c.credential_id))
            for c in existing
        ]
        options = webauthn.generate_registration_options(
            rp_id=settings.webauthn_rp_id,
            rp_name=settings.webauthn_rp_name,
            user_id=user.id.encode("utf-8"),
            user_name=user.username or user.id,
            user_display_name=user.display_name,
            exclude_credentials=exclude or None,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.PREFERRED,
                user_verification=UserVerificationRequirement.PREFERRED,
            ),
        )
        await self.cache.set_json(
            self._reg_challenge_key(user.id),
            {"challenge": bytes_to_base64url(options.challenge)},
            ttl=CHALLENGE_TTL_SECONDS,
        )
        return options_to_json_dict(options)

    async def finish_registration(
        self, db: AsyncSession, user: User, credential: dict, name: str = "Passkey"
    ) -> WebauthnCredential:
        stored = await self.cache.get_json(self._reg_challenge_key(user.id))
        if not stored:
            raise WebauthnServiceError("A regisztráció lejárt vagy nem indult el újra próbálkozz.")
        expected_challenge = webauthn.base64url_to_bytes(stored["challenge"])

        try:
            verified = webauthn.verify_registration_response(
                credential=credential,
                expected_challenge=expected_challenge,
                expected_rp_id=settings.webauthn_rp_id,
                expected_origin=settings.webauthn_origin,
            )
        except WebAuthnException as exc:
            raise WebauthnServiceError(f"Érvénytelen regisztrációs válasz: {exc}") from exc

        cred = WebauthnCredential(
            user_id=user.id,
            credential_id=bytes_to_base64url(verified.credential_id),
            public_key=verified.credential_public_key,
            sign_count=verified.sign_count,
            name=name.strip() or "Passkey",
        )
        db.add(cred)
        await db.commit()
        await db.refresh(cred)
        return cred

    async def begin_authentication(self) -> dict:
        options = webauthn.generate_authentication_options(
            rp_id=settings.webauthn_rp_id,
            user_verification=UserVerificationRequirement.PREFERRED,
        )
        ceremony_id = secrets.token_urlsafe(16)
        await self.cache.set_json(
            self._auth_challenge_key(ceremony_id),
            {"challenge": bytes_to_base64url(options.challenge)},
            ttl=CHALLENGE_TTL_SECONDS,
        )
        return {"ceremony_id": ceremony_id, "options": options_to_json_dict(options)}

    async def finish_authentication(
        self, db: AsyncSession, ceremony_id: str, credential: dict
    ) -> User:
        stored = await self.cache.get_json(self._auth_challenge_key(ceremony_id))
        if not stored:
            raise WebauthnServiceError("A bejelentkezés lejárt, próbáld újra.")
        expected_challenge = webauthn.base64url_to_bytes(stored["challenge"])

        raw_credential_id = credential.get("id") or credential.get("rawId")
        if not raw_credential_id:
            raise WebauthnServiceError("Hiányzó credential azonosító.")

        stored_cred = (
            await db.execute(
                select(WebauthnCredential).where(WebauthnCredential.credential_id == raw_credential_id)
            )
        ).scalar_one_or_none()
        if stored_cred is None:
            raise WebauthnServiceError("Ismeretlen passkey — regisztráld előbb a Fiókom oldalon.")

        try:
            verified = webauthn.verify_authentication_response(
                credential=credential,
                expected_challenge=expected_challenge,
                expected_rp_id=settings.webauthn_rp_id,
                expected_origin=settings.webauthn_origin,
                credential_public_key=stored_cred.public_key,
                credential_current_sign_count=stored_cred.sign_count,
            )
        except WebAuthnException as exc:
            raise WebauthnServiceError(f"Érvénytelen bejelentkezési válasz: {exc}") from exc

        stored_cred.sign_count = verified.new_sign_count
        user = (
            await db.execute(select(User).where(User.id == stored_cred.user_id))
        ).scalar_one_or_none()
        if user is None:
            raise WebauthnServiceError("A felhasználó már nem létezik.")
        await db.commit()
        return user

    async def list_credentials(self, db: AsyncSession, user_id: str) -> list[WebauthnCredential]:
        result = await db.execute(
            select(WebauthnCredential)
            .where(WebauthnCredential.user_id == user_id)
            .order_by(WebauthnCredential.created_at)
        )
        return list(result.scalars().all())

    async def delete_credential(self, db: AsyncSession, user_id: str, credential_id: str) -> None:
        await db.execute(
            delete(WebauthnCredential).where(
                WebauthnCredential.user_id == user_id, WebauthnCredential.id == credential_id
            )
        )
        await db.commit()
