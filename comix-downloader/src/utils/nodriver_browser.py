"""
Shared nodriver browser launch helpers.
"""

import threading
import os
from typing import Any

from .logger import get_logger
from .nodriver_compat import load_nodriver


logger = get_logger(__name__)


_COMMON_BROWSER_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-ipc-flooding-protection",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-site-isolation-trials",
    "--disable-infobars",
    "--disable-extensions",
    "--disable-popup-blocking",
    "--disable-notifications",
    "--disable-translate",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-logging",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-software-rasterizer",
    "--disable-smooth-scrolling",
    "--disable-animations",
    "--disable-transitions",
    "--disable-plugins",
    "--disable-image-animation",
    "--disable-preload",
    "--disable-async-dns",
    "--disable-ipv6",
    "--disable-dns-prefetch",
    "--disable-hang-monitor",
    "--disable-prompt-on-repost",
    "--disable-windows10-custom-titlebar",
    "--disable-features=NetworkService,NetworkServiceInProcess",
    "--disable-features=VizDisplayCompositor",
    "--disable-features=WebRtcHideLocalIps",
    "--disable-features=WebRtcHideLocalIpsWithMdns",
    "--disable-features=WebRtcUseLocalDnsResolver",
]

_HEADLESS_WINDOW_SIZE = "1920,1080"

_user_agent_cache: str | None = None
_user_agent_cache_lock = threading.Lock()


def _sandbox_enabled() -> bool:
    """Use Chrome's sandbox except where root execution makes it impossible."""
    return not (os.name == "posix" and getattr(os, "geteuid", lambda: 1)() == 0)


def _make_config(config_factory: Any, *, headless: bool, browser_args: list[str]):
    """Create a Config while remaining compatible with lightweight facades."""
    try:
        return config_factory(
            headless=headless,
            browser_args=list(browser_args),
            sandbox=_sandbox_enabled(),
        )
    except TypeError:
        return config_factory(headless=headless, browser_args=list(browser_args))


def get_browser_args(headless: bool, platform: str | None = None) -> list[str]:
    """Return Chrome args for nodriver's headful/headless launch modes.

    ``platform`` is retained for source compatibility with earlier callers;
    native headless mode is platform-independent and does not need window
    positioning tricks.
    """
    del platform
    browser_args = list(_COMMON_BROWSER_ARGS)

    if headless:
        browser_args.append(f"--window-size={_HEADLESS_WINDOW_SIZE}")
    else:
        browser_args.append("--start-maximized")

    return browser_args


def _is_headless_argument(argument: str) -> bool:
    return argument == "--headless" or argument.startswith("--headless=")


def _validate_effective_args(headless: bool, effective_args: list[str]) -> None:
    """Fail closed if nodriver does not produce the requested mode."""
    headless_args = [argument for argument in effective_args if _is_headless_argument(argument)]

    if headless:
        if "--headless=new" not in headless_args:
            raise RuntimeError(
                "Headless mode was requested, but nodriver did not produce --headless=new"
            )
        if "--start-maximized" in effective_args:
            raise RuntimeError("Headless mode must not include --start-maximized")
    elif headless_args:
        raise RuntimeError(
            "Headful mode was requested, but nodriver produced a headless switch"
        )


def normalize_desktop_user_agent(user_agent: str) -> str:
    """Return Chrome's normal desktop UA for a browser-reported UA.

    Chrome's native headless mode differs from headful Chrome only by the
    ``HeadlessChrome`` product token in the user agent.  Cloudflare clearance
    is sensitive to that identity, so both launch modes must use the same
    desktop token.
    """
    if not isinstance(user_agent, str) or not user_agent.strip():
        raise RuntimeError("Chrome did not report a usable user agent")
    normalized = user_agent.replace("HeadlessChrome/", "Chrome/")
    if "HeadlessChrome" in normalized:
        raise RuntimeError("Unable to normalize Chrome's headless user agent")
    return normalized


def _read_reported_user_agent(browser: Any) -> str | None:
    """Read the user agent from nodriver's browser version information."""
    info = getattr(browser, "info", None)
    if info is None:
        return None
    getter = getattr(info, "get", None)
    if callable(getter):
        value = getter("User-Agent")
        if isinstance(value, str) and value.strip():
            return value
    value = getattr(info, "user_agent", None)
    return value if isinstance(value, str) and value.strip() else None


async def _probe_desktop_user_agent(uc: Any, config_factory: Any) -> str:
    """Probe Chrome once on a blank page and normalize its reported UA.

    The probe avoids hard-coded platform/version strings and works with Chrome
    installations whose executable does not expose a portable ``--version``
    command (notably Windows builds).  It never visits Comix or loads cookies.
    """
    probe_args = get_browser_args(True)
    probe_config = _make_config(config_factory, headless=True, browser_args=probe_args)
    probe_browser = await uc.start(
        config=probe_config,
        headless=True,
        browser_args=probe_args,
    )
    try:
        reported = _read_reported_user_agent(probe_browser)
        if not reported:
            tab = getattr(probe_browser, "main_tab", None)
            if tab is not None:
                reported = await tab.evaluate("navigator.userAgent")
        return normalize_desktop_user_agent(reported or "")
    finally:
        aclose = getattr(probe_browser, "aclose", None)
        if callable(aclose):
            try:
                await aclose()
            except Exception:
                pass
        stop = getattr(probe_browser, "stop", None)
        if callable(stop):
            stop()


async def _get_desktop_user_agent(uc: Any, config_factory: Any) -> str:
    """Return a cached normalized desktop UA for this process."""
    global _user_agent_cache
    with _user_agent_cache_lock:
        cached = _user_agent_cache
    if cached:
        return cached

    # The Comix API already serializes browser startup through its process-wide
    # lock.  The second check prevents redundant probes for direct callers that
    # happen to race during initialization without holding an async lock across
    # an await.
    probed = await _probe_desktop_user_agent(uc, config_factory)
    with _user_agent_cache_lock:
        if _user_agent_cache is None:
            _user_agent_cache = probed
        return _user_agent_cache


async def start_browser(headless: bool, nodriver: Any = None, user_data_dir: str | None = None):
    """Start nodriver using the shared browser argument policy."""
    if not isinstance(headless, bool):
        raise TypeError(f"headless must be a bool, got {type(headless).__name__}")

    uc = nodriver if nodriver is not None else load_nodriver()
    browser_args = get_browser_args(headless)
    if user_data_dir:
        browser_args.append(f"--user-data-dir={user_data_dir}")

    # Supplying an explicit Config lets us verify the final command line
    # before Chrome is spawned.  Keep the fallback for lightweight test doubles
    # and compatible nodriver facades that only expose ``start``.
    config_factory = getattr(uc, "Config", None)
    if config_factory is None:
        return await uc.start(headless=headless, browser_args=browser_args)

    config = _make_config(config_factory, headless=headless, browser_args=browser_args)
    _validate_effective_args(headless, list(config()))
    desktop_user_agent = await _get_desktop_user_agent(uc, config_factory)
    user_agent_arg = f"--user-agent={desktop_user_agent}"
    add_argument = getattr(config, "add_argument", None)
    if not callable(add_argument):
        raise RuntimeError("nodriver Config cannot apply the normalized desktop user agent")
    add_argument(user_agent_arg)
    # Config receives a copied argument list, so adding the argument to the
    # launch request here does not duplicate it inside Config._browser_args.
    browser_args = list(browser_args) + [user_agent_arg]

    # If Chrome is already running with remote debugging, reuse it so we
    # inherit its cleared Cloudflare cookies instead of launching fresh.
    connect_url = os.environ.get("CHROME_CDP_URL")
    if not connect_url and user_data_dir:
        try:
            import json
            from urllib.request import urlopen
            from urllib.error import URLError
            import socket
            devtools_path = Path(user_data_dir) / "DevToolsActivePort"
            if devtools_path.exists():
                port_file = json.loads(devtools_path.read_text(encoding="utf-8"))
                host = port_file.get("host", "127.0.0.1")
                port = int(port_file.get("port", 0))
                if port:
                    connect_url = f"http://{host}:{port}"
            else:
                for port in [9222, 9223, 9224, 9225, 9226]:
                    try:
                        with urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1):
                            connect_url = f"http://127.0.0.1:{port}"
                            break
                    except (URLError, socket.timeout):
                        continue
        except Exception:
            connect_url = None

    if connect_url:
        try:
            logger.info("Attempting to connect to existing Chrome at %s", connect_url)
            return await uc.start(
                config=config,
                connect_url=connect_url,
                headless=headless,
                browser_args=browser_args,
            )
        except Exception as exc:
            logger.warning("Failed to connect to existing Chrome at %s: %s", connect_url, exc)

    effective_args = list(config())
    _validate_effective_args(headless, effective_args)
    logger.debug(
        "Starting browser (headless=%s, executable=%s)",
        headless,
        getattr(config, "browser_executable_path", "unknown"),
    )

    return await uc.start(
        config=config,
        connect_url=connect_url,
        # Keep these explicit for compatibility with nodriver facades and
        # direct callers that inspect the launch request.
        headless=headless,
        browser_args=browser_args,
    )
