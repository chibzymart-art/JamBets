"""
JamBets — Autonomous Alerting Module
Provides zero-cost email and webhook alerting for engine failures,
zero-prediction misfires, and settlement anomalies.
"""

from .email_notifier import (
    send_email_alert,
    send_pipeline_failure_alert,
    send_zero_predictions_alert,
    send_settlement_lag_alert
)

__all__ = [
    "send_email_alert",
    "send_pipeline_failure_alert",
    "send_zero_predictions_alert",
    "send_settlement_lag_alert"
]
