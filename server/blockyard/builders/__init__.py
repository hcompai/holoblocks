from blockyard.builders.holo import HoloBuilder
from blockyard.builders.scripted import ScriptedBuilder
from blockyard.builders.showcases import SHOWCASES
from blockyard.session import Builder

holo = HoloBuilder.from_env()
BUILDERS: dict[str, Builder] = {
    **({"holo": holo} if holo else {}),
    **{s.key: ScriptedBuilder(s) for s in SHOWCASES},
}
