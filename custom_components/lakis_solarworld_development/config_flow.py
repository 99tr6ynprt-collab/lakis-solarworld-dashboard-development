from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlowResult,
    OptionsFlowWithReload,
)
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    EntitySelector,
    EntitySelectorConfig,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .license import verify_license


DOMAIN = "lakis_solarworld_development"

MODULES = [
    "energy",
    "pv",
    "grid",
    "battery",
    "wallbox",
    "vehicle",
    "heatpump",
    "climate",
]

DEFAULT_MODULES = [
    "energy",
    "pv",
    "grid",
    "battery",
]


def entity_selector(
    domain: str | None = None,
    multiple: bool = False,
) -> EntitySelector:
    """Create an entity selector."""

    if domain:
        return EntitySelector(
            EntitySelectorConfig(
                domain=domain,
                multiple=multiple,
            )
        )

    return EntitySelector(
        EntitySelectorConfig(
            multiple=multiple,
        )
    )


def module_selector(
    default: list[str],
) -> SelectSelector:
    """Create the module selector."""

    return SelectSelector(
        SelectSelectorConfig(
            options=MODULES,
            multiple=True,
            mode=SelectSelectorMode.LIST,
        )
    )


class LakisConfigFlow(
    config_entries.ConfigFlow,
    domain=DOMAIN,
):
    """Handle LAKIS SOLARWORLD setup."""

    VERSION = 3

    def __init__(self) -> None:
        """Initialize."""
        self._data: dict[str, Any] = {}
        self._modules: list[str] = []

    # ------------------------------------------------------------------
    # LICENSE
    # ------------------------------------------------------------------

    async def async_step_user(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:
        """Enter the license key."""

        errors: dict[str, str] = {}

        if user_input is not None:

            try:
                info = verify_license(
                    user_input["license_key"].strip()
                )

            except ValueError:
                errors["license_key"] = "invalid_license"

            else:

                await self.async_set_unique_id(
                    info.license_id
                )

                self._abort_if_unique_id_configured()

                self._data = {
                    "license_key":
                        user_input[
                            "license_key"
                        ].strip(),

                    "license_id":
                        info.license_id,

                    "license_plan":
                        "PRO",

                    "license_lifetime":
                        True,

                    "license_customer":
                        info.customer,
                }

                return await self.async_step_modules()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "license_key"
                    ): str,
                }
            ),
            errors=errors,
        )

    # ------------------------------------------------------------------
    # MODULES
    # ------------------------------------------------------------------

    async def async_step_modules(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:
        """Select active modules."""

        if user_input is not None:

            self._modules = list(
                user_input["modules"]
            )

            self._data["modules"] = (
                self._modules
            )

            return await self._next_module(
                -1
            )

        return self.async_show_form(
            step_id="modules",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "modules",
                        default=DEFAULT_MODULES,
                    ): module_selector(
                        DEFAULT_MODULES
                    ),
                }
            ),
        )

    # ------------------------------------------------------------------
    # MODULE NAVIGATION
    # ------------------------------------------------------------------

    async def _next_module(
        self,
        current_index: int,
    ) -> ConfigFlowResult:
        """Open the next enabled module."""

        order = [
            "energy",
            "pv",
            "grid",
            "battery",
            "wallbox",
            "vehicle",
            "heatpump",
            "climate",
        ]

        active = set(
            self._modules
        )

        for index in range(
            current_index + 1,
            len(order),
        ):

            module = order[index]

            if module in active:

                return await getattr(
                    self,
                    f"async_step_{module}",
                )()

        return self.async_create_entry(
            title="LAKIS SOLARWORLD PRO",
            data=self._data,
        )

    async def _module_step(
        self,
        module: str,
        index: int,
        schema: vol.Schema,
        user_input: dict[str, Any] | None,
    ) -> ConfigFlowResult:
        """Handle a module configuration step."""

        if user_input is not None:

            self._data.update(
                user_input
            )

            return await self._next_module(
                index
            )

        return self.async_show_form(
            step_id=module,
            data_schema=schema,
        )

    # ------------------------------------------------------------------
    # ENERGY
    # ------------------------------------------------------------------

    async def async_step_energy(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._module_step(
            "energy",
            0,
            vol.Schema(
                {
                    vol.Required(
                        "house_power"
                    ): entity_selector(),
                }
            ),
            user_input,
        )

    # ------------------------------------------------------------------
    # PV
    # ------------------------------------------------------------------

    async def async_step_pv(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._module_step(
            "pv",
            1,
            vol.Schema(
                {
                    vol.Required(
                        "pv_power"
                    ): entity_selector(),
                }
            ),
            user_input,
        )

    # ------------------------------------------------------------------
    # GRID
    # ------------------------------------------------------------------

    async def async_step_grid(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._module_step(
            "grid",
            2,
            vol.Schema(
                {
                    vol.Required(
                        "grid_power"
                    ): entity_selector(),
                }
            ),
            user_input,
        )

    # ------------------------------------------------------------------
    # BATTERY
    # ------------------------------------------------------------------

    async def async_step_battery(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._module_step(
            "battery",
            3,
            vol.Schema(
                {
                    vol.Required(
                        "battery_soc"
                    ): entity_selector(),

                    vol.Required(
                        "battery_power"
                    ): entity_selector(),

                    vol.Optional(
                        "battery_capacity_kwh",
                        default=10.0,
                    ): vol.Coerce(float),

                    vol.Optional(
                        "battery_target_soc",
                        default=80,
                    ): vol.All(
                        vol.Coerce(int),
                        vol.Range(
                            min=1,
                            max=100,
                        ),
                    ),
                }
            ),
            user_input,
        )

    # ------------------------------------------------------------------
    # WALLBOX
    # ------------------------------------------------------------------

    async def async_step_wallbox(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._module_step(
            "wallbox",
            4,
            vol.Schema(
                {
                    vol.Required(
                        "wallbox_power"
                    ): entity_selector(),

                    vol.Optional(
                        "wallbox_status"
                    ): entity_selector(),
                }
            ),
            user_input,
        )

    # ------------------------------------------------------------------
    # VEHICLE
    # ------------------------------------------------------------------

    async def async_step_vehicle(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._module_step(
            "vehicle",
            5,
            vol.Schema(
                {
                    vol.Optional(
                        "vehicle_name",
                        default="Fahrzeug",
                    ): str,

                    vol.Optional(
                        "vehicle_soc"
                    ): entity_selector(),

                    vol.Optional(
                        "vehicle_status"
                    ): entity_selector(),

                    vol.Optional(
                        "vehicle_target_soc",
                        default=80,
                    ): vol.All(
                        vol.Coerce(int),
                        vol.Range(
                            min=1,
                            max=100,
                        ),
                    ),
                }
            ),
            user_input,
        )

    # ------------------------------------------------------------------
    # HEAT PUMP
    # ------------------------------------------------------------------

    async def async_step_heatpump(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._module_step(
            "heatpump",
            6,
            vol.Schema(
                {
                    vol.Required(
                        "heatpump_entity"
                    ): entity_selector(
                        domain="climate"
                    ),

                    vol.Optional(
                        "heatpump_power"
                    ): entity_selector(),

                    vol.Optional(
                        "heatpump_flow_temp"
                    ): entity_selector(),

                    vol.Optional(
                        "heatpump_return_temp"
                    ): entity_selector(),

                    vol.Optional(
                        "heatpump_outdoor_temp"
                    ): entity_selector(),

                    vol.Optional(
                        "heatpump_dhw_temp"
                    ): entity_selector(),
                }
            ),
            user_input,
        )

    # ------------------------------------------------------------------
    # CLIMATE
    # ------------------------------------------------------------------

    async def async_step_climate(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._module_step(
            "climate",
            7,
            vol.Schema(
                {
                    vol.Required(
                        "climate_entities"
                    ): entity_selector(
                        domain="climate",
                        multiple=True,
                    ),
                }
            ),
            user_input,
        )

    # ------------------------------------------------------------------
    # OPTIONS FLOW
    # ------------------------------------------------------------------

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: ConfigEntry,
    ) -> LakisOptionsFlow:
        """Return options flow."""

        return LakisOptionsFlow()


class LakisOptionsFlow(
    OptionsFlowWithReload
):
    """Handle LAKIS SOLARWORLD options."""

    def __init__(self) -> None:
        """Initialize."""
        self._data: dict[str, Any] = {}

    async def async_step_init(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:
        """Edit dashboard configuration."""

        current = dict(
            self.config_entry.options
        )

        if not current:
            current = dict(
                self.config_entry.data
            )

        if user_input is not None:

            self._data = dict(
                current
            )

            self._data.update(
                user_input
            )

            return await self._next_option(
                -1
            )

        modules = list(
            current.get(
                "modules",
                DEFAULT_MODULES,
            )
        )

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "modules",
                        default=modules,
                    ): module_selector(
                        modules
                    ),
                }
            ),
        )

    async def _next_option(
        self,
        current_index: int,
    ) -> ConfigFlowResult:
        """Open next enabled option."""

        order = [
            "energy",
            "pv",
            "grid",
            "battery",
            "wallbox",
            "vehicle",
            "heatpump",
            "climate",
        ]

        active = set(
            self._data.get(
                "modules",
                DEFAULT_MODULES,
            )
        )

        for index in range(
            current_index + 1,
            len(order),
        ):

            module = order[index]

            if module in active:

                return await getattr(
                    self,
                    f"async_step_{module}",
                )()

        return self.async_create_entry(
            data=self._data
        )

    async def _option_step(
        self,
        module: str,
        index: int,
        schema: vol.Schema,
        user_input: dict[str, Any] | None,
    ) -> ConfigFlowResult:

        if user_input is not None:

            self._data.update(
                user_input
            )

            return await self._next_option(
                index
            )

        return self.async_show_form(
            step_id=module,
            data_schema=self.add_suggested_values_to_schema(
                schema,
                self.config_entry.options,
            ),
        )

    async def async_step_energy(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._option_step(
            "energy",
            0,
            vol.Schema(
                {
                    vol.Optional(
                        "house_power"
                    ): entity_selector(),
                }
            ),
            user_input,
        )

    async def async_step_pv(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._option_step(
            "pv",
            1,
            vol.Schema(
                {
                    vol.Optional(
                        "pv_power"
                    ): entity_selector(),
                }
            ),
            user_input,
        )

    async def async_step_grid(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._option_step(
            "grid",
            2,
            vol.Schema(
                {
                    vol.Optional(
                        "grid_power"
                    ): entity_selector(),
                }
            ),
            user_input,
        )

    async def async_step_battery(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._option_step(
            "battery",
            3,
            vol.Schema(
                {
                    vol.Optional(
                        "battery_soc"
                    ): entity_selector(),

                    vol.Optional(
                        "battery_power"
                    ): entity_selector(),

                    vol.Optional(
                        "battery_capacity_kwh"
                    ): vol.Coerce(float),

                    vol.Optional(
                        "battery_target_soc"
                    ): vol.All(
                        vol.Coerce(int),
                        vol.Range(
                            min=1,
                            max=100,
                        ),
                    ),
                }
            ),
            user_input,
        )

    async def async_step_wallbox(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._option_step(
            "wallbox",
            4,
            vol.Schema(
                {
                    vol.Optional(
                        "wallbox_power"
                    ): entity_selector(),

                    vol.Optional(
                        "wallbox_status"
                    ): entity_selector(),
                }
            ),
            user_input,
        )

    async def async_step_vehicle(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._option_step(
            "vehicle",
            5,
            vol.Schema(
                {
                    vol.Optional(
                        "vehicle_name"
                    ): str,

                    vol.Optional(
                        "vehicle_soc"
                    ): entity_selector(),

                    vol.Optional(
                        "vehicle_status"
                    ): entity_selector(),

                    vol.Optional(
                        "vehicle_target_soc"
                    ): vol.All(
                        vol.Coerce(int),
                        vol.Range(
                            min=1,
                            max=100,
                        ),
                    ),
                }
            ),
            user_input,
        )

    async def async_step_heatpump(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._option_step(
            "heatpump",
            6,
            vol.Schema(
                {
                    vol.Optional(
                        "heatpump_entity"
                    ): entity_selector(
                        domain="climate"
                    ),

                    vol.Optional(
                        "heatpump_power"
                    ): entity_selector(),

                    vol.Optional(
                        "heatpump_flow_temp"
                    ): entity_selector(),

                    vol.Optional(
                        "heatpump_return_temp"
                    ): entity_selector(),

                    vol.Optional(
                        "heatpump_outdoor_temp"
                    ): entity_selector(),

                    vol.Optional(
                        "heatpump_dhw_temp"
                    ): entity_selector(),
                }
            ),
            user_input,
        )

    async def async_step_climate(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:

        return await self._option_step(
            "climate",
            7,
            vol.Schema(
                {
                    vol.Optional(
                        "climate_entities"
                    ): entity_selector(
                        domain="climate",
                        multiple=True,
                    ),
                }
            ),
            user_input,
        )