"""
JamBets — Base Data Source Adapter (Phase 4.7)
Defines standard interface, realistic User-Agent rotation, stealth rate-limiting,
and 3-attempt exponential backoff retry execution for all data collectors.
"""

from abc import ABC, abstractmethod
from datetime import datetime, timezone
import random
import time
from typing import List, Optional, Dict, Any, Callable
import httpx
from python.src.config import LeagueConfig
from python.src.football.models import RawFixturePayload

USER_AGENT_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
]


class BaseSourceAdapter(ABC):
    """
    Base class for all multi-source sports collectors.
    Enforces stealth, realistic header rotation, provider-specific rate limiting,
    and 3-attempt exponential backoff retry loops.
    """

    def __init__(
        self,
        name: str,
        slug: str,
        base_url: str,
        rate_limit_delay_seconds: float = 1.5,
        max_retries: int = 3
    ):
        self.name = name
        self.slug = slug
        self.base_url = base_url
        self.rate_limit_delay_seconds = rate_limit_delay_seconds
        self.max_retries = max_retries
        self._last_request_time: float = 0.0
        self.client = httpx.Client(timeout=15.0, follow_redirects=True)

    def get_headers(self, extra_headers: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """Rotates realistic User-Agent and standard browser headers."""
        headers = {
            "User-Agent": random.choice(USER_AGENT_POOL),
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Sec-Ch-Ua": '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin"
        }
        if extra_headers:
            headers.update(extra_headers)
        return headers

    def _enforce_rate_limit(self) -> None:
        """Enforces respectful HTTP delay between outbound requests."""
        now = time.time()
        elapsed = now - self._last_request_time
        if elapsed < self.rate_limit_delay_seconds:
            sleep_duration = self.rate_limit_delay_seconds - elapsed
            time.sleep(sleep_duration)
        self._last_request_time = time.time()

    def execute_with_retry(
        self,
        request_fn: Callable[[], Any],
        operation_name: str = "request"
    ) -> Any:
        """
        Executes an HTTP request within an exponential backoff retry loop (maximum 3 attempts).
        Retries on None, empty responses, 429 rate limits, and 5xx server errors.
        """
        last_exception = None

        for attempt in range(1, self.max_retries + 1):
            self._enforce_rate_limit()
            try:
                result = request_fn()

                if result is not None:
                    return result

            except httpx.HTTPStatusError as exc:
                last_exception = exc
                status_code = exc.response.status_code
                if status_code in (429, 500, 502, 503, 504) and attempt < self.max_retries:
                    backoff = (2.0 ** attempt) + random.uniform(0.5, 1.5)
                    print(f"[{self.name}] HTTP {status_code} on {operation_name} (attempt {attempt}/{self.max_retries}). Retrying in {backoff:.1f}s...")
                    time.sleep(backoff)
                else:
                    # Non-retryable client error (e.g. 404) or final attempt exhausted
                    if attempt == self.max_retries:
                        print(f"[{self.name}] Final attempt failed on {operation_name} with HTTP {status_code}: {exc}")
                    break

            except (httpx.RequestError, httpx.TimeoutException) as exc:
                last_exception = exc
                if attempt < self.max_retries:
                    backoff = (2.0 ** attempt) + random.uniform(0.3, 1.0)
                    print(f"[{self.name}] Network error on {operation_name} ({exc.__class__.__name__}). Retrying in {backoff:.1f}s (attempt {attempt}/{self.max_retries})...")
                    time.sleep(backoff)
                else:
                    print(f"[{self.name}] Exhausted {self.max_retries} attempts for {operation_name}: {exc}")
                    break

            except Exception as exc:
                last_exception = exc
                print(f"[{self.name}] Unexpected error on {operation_name}: {exc}")
                break

        return None

    def get_json_with_retry(
        self,
        url: str,
        params: Optional[Dict[str, Any]] = None,
        extra_headers: Optional[Dict[str, str]] = None
    ) -> Optional[Dict[str, Any]]:
        """Convenience method for GET requests expecting JSON."""
        def _fetch():
            headers = self.get_headers(extra_headers)
            resp = self.client.get(url, params=params, headers=headers, timeout=14.0)
            resp.raise_for_status()
            return resp.json()

        return self.execute_with_retry(_fetch, operation_name=f"GET {url}")

    def get_text_with_retry(
        self,
        url: str,
        params: Optional[Dict[str, Any]] = None,
        extra_headers: Optional[Dict[str, str]] = None
    ) -> Optional[str]:
        """Convenience method for GET requests expecting text/XML/HTML."""
        def _fetch():
            headers = self.get_headers(extra_headers)
            resp = self.client.get(url, params=params, headers=headers, timeout=14.0)
            resp.raise_for_status()
            return resp.text

        return self.execute_with_retry(_fetch, operation_name=f"GET {url}")

    @abstractmethod
    def fetch_fixtures(self, league: LeagueConfig, date_from: datetime, date_to: datetime) -> List[RawFixturePayload]:
        """Fetches upcoming fixtures within date range from this source."""
        pass

    @abstractmethod
    def fetch_live_scores(self, league: LeagueConfig) -> List[RawFixturePayload]:
        """Fetches active live fixtures from this source."""
        pass
