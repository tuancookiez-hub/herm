"""Eikon install plugin."""

from __future__ import annotations

from .schemas import EIKON_INSTALL_SCHEMA
from .tools import _handle_eikon_install, check_herm_available


def register(ctx) -> None:
    ctx.register_tool(
        name="eikon_install",
        toolset="eikon",
        schema=EIKON_INSTALL_SCHEMA,
        handler=_handle_eikon_install,
        check_fn=check_herm_available,
        emoji="⬡",
    )
