"""Outbound email via Resend (https://resend.com).

Set RESEND_API_KEY and EMAIL_FROM in backend/.env to send real mail; EMAIL_FROM
must use a domain verified in your Resend account, e.g.
    EMAIL_FROM="Backtester <verify@yourdomain.com>"

With no key configured, emails are logged to the server console and the
confirmation URL is returned to the API caller (dev convenience only).
"""
import logging

import httpx

from .config import get_settings

log = logging.getLogger("email")
settings = get_settings()

RESEND_URL = "https://api.resend.com/emails"


def send_email(to: str, subject: str, html: str) -> bool:
    """Returns True if a real email was dispatched."""
    if settings.resend_api_key:
        return _send_via_resend(to, subject, html)
    log.info("[DEV EMAIL → %s] %s\n%s", to, subject, html)
    return False


def _send_via_resend(to: str, subject: str, html: str) -> bool:
    try:
        resp = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.email_from, "to": [to], "subject": subject, "html": html},
            timeout=15,
        )
        resp.raise_for_status()
        log.info("Resend accepted email to %s (id=%s)", to, resp.json().get("id"))
        return True
    except httpx.HTTPStatusError as exc:
        # Surface Resend's reason (unverified domain, invalid recipient, etc.)
        log.error("Resend rejected email to %s: %s — %s", to, exc.response.status_code, exc.response.text)
        raise
    except Exception as exc:
        log.error("Resend request failed for %s: %s", to, exc)
        raise
