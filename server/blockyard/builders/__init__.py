from blockyard.builders.demo import DemoBuilder
from blockyard.builders.holo import HoloBuilder
from blockyard.session import Builder

holo = HoloBuilder.from_env()
BUILDERS: dict[str, Builder] = {**({"holo": holo} if holo else {}), "demo": DemoBuilder()}
