"""A hidden browser tab on each build that asks for renders, so a builder sees its model with no viewer open."""

from __future__ import annotations

import asyncio
import logging
import sys

from playwright.async_api import Browser, Page, Playwright, async_playwright

LOGGER = logging.getLogger(__name__)
GPU_ARGS = ["--use-angle=metal"] if sys.platform == "darwin" else []


class Renderer:
    def __init__(self, url: str):
        self.url = url
        self.disabled = False
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._pages: dict[str, Page] = {}
        self._lock = asyncio.Lock()

    async def watch(self, build_id: str) -> None:
        """Keep a hidden tab open on the build; when no browser starts, renders are left to open viewers."""
        async with self._lock:
            if self.disabled or build_id in self._pages:
                return
            try:
                if self._browser is None:
                    self._playwright = await async_playwright().start()
                    self._browser = await self._playwright.chromium.launch(args=GPU_ARGS)
                page = await self._browser.new_page()
                await page.goto(f"{self.url}/?build={build_id}")
                self._pages[build_id] = page
            except Exception as e:  # noqa: BLE001
                LOGGER.warning(f"No hidden viewer, renders need an open one: {e}")
                self.disabled = True

    async def release(self, build_id: str) -> None:
        page = self._pages.pop(build_id, None)
        if page is not None:
            await page.close()

    async def stop(self) -> None:
        if self._browser is not None:
            await self._browser.close()
        if self._playwright is not None:
            await self._playwright.stop()
