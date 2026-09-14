"""
JamBets Autonomous Email Marketing & Relay Engine
"""

from .relay_pool import SmartRelayPool, RelayResult, BaseRelay, SmtpRelay, ConsoleMockRelay
from .templates import render_email_template, TEMPLATE_MAP
from .dispatcher import EmailDispatcher

__all__ = [
    "SmartRelayPool",
    "RelayResult",
    "BaseRelay",
    "SmtpRelay",
    "ConsoleMockRelay",
    "render_email_template",
    "TEMPLATE_MAP",
    "EmailDispatcher"
]
