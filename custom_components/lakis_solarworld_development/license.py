from __future__ import annotations

import base64
import json
from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

LICENSE_PREFIX = "LSWP1-"
PUBLIC_KEY_B64 = "KXDvB2ajTnxGx9CBmvdJG_WOTB3pmd2cCTT2iSZapW4"

@dataclass(frozen=True)
class LicenseInfo:
    license_id: str
    product: str
    plan: str
    lifetime: bool
    customer: str = ""

def _b64pad(s: str) -> str:
    return s + "=" * (-len(s) % 4)

def verify_license(key: str) -> LicenseInfo:
    if not isinstance(key, str) or not key.startswith(LICENSE_PREFIX):
        raise ValueError("Ungültiger LAKIS Lizenzschlüssel")
    token = key[len(LICENSE_PREFIX):].strip()
    try:
        payload_b64, sig_b64 = token.split(".", 1)
        payload = base64.urlsafe_b64decode(_b64pad(payload_b64))
        signature = base64.urlsafe_b64decode(_b64pad(sig_b64))
        Ed25519PublicKey.from_public_bytes(
            base64.urlsafe_b64decode(_b64pad(PUBLIC_KEY_B64))
        ).verify(signature, payload)
        data = json.loads(payload.decode("utf-8"))
    except Exception as err:
        raise ValueError("Lizenzschlüssel konnte nicht verifiziert werden") from err
    if data.get("product") != "LAKIS_SOLARWORLD":
        raise ValueError("Lizenz gehört nicht zu LAKIS SOLARWORLD")
    if data.get("plan") != "PRO" or data.get("lifetime") is not True:
        raise ValueError("Keine gültige LAKIS PRO Lifetime-Lizenz")
    license_id = str(data.get("id", "")).strip()
    if not license_id:
        raise ValueError("Lizenz-ID fehlt")
    return LicenseInfo(license_id, data["product"], data["plan"], True, str(data.get("customer", "")))
