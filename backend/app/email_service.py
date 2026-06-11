"""Outbound email.

PLACEHOLDER[EMAIL SERVICE]: set EMAIL_API_KEY in backend/.env and implement
`_send_via_provider` for Resend / Postmark / SES. Expected call shape:
    POST https://api.resend.com/emails
    {"from": EMAIL_FROM, "to": [to], "subject": subject, "html": html}

Until a key is configured, emails are logged to the server console and the
confirmation URL is returned to the API caller (dev convenience only).
"""
import logging

from .config import get_settings

log = logging.getLogger("email")
settings = get_settings()


def send_email(to: str, subject: str, html: str) -> bool:
    """Returns True if a real email was dispatched."""
    if settings.email_api_key:
        return _send_via_provider(to, subject, html)
    log.info("[DEV EMAIL → %s] %s\n%s", to, subject, html)
    return False


def _send_via_provider(to: str, subject: str, html: str) -> bool:
    # PLACEHOLDER[EMAIL SERVICE]: real provider call goes here, e.g.
    #   httpx.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {settings.email_api_key}"},
    #              json={"from": settings.email_from, "to": [to], "subject": subject, "html": html})
    raise NotImplementedError("Wire your email provider in app/email_service.py")
