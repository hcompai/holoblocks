from blockyard.builders.scripted import Showcase

SHOWCASES = [
    Showcase(
        key="steampunk-manor",
        name="Overgrown Steampunk Manor",
        label="Showcase: steampunk manor",
        intro=(
            "Scripted showcase: an overgrown steampunk manor with a steep copper roof, timber-framed plaster and "
            "smoking chimneys."
        ),
    ),
    Showcase(
        key="gothic-cathedral",
        name="Gothic Cathedral",
        label="Showcase: gothic cathedral",
        intro=(
            "Scripted showcase: a dark gothic cathedral with flying buttresses, rose windows, gargoyles and "
            "two openwork stone spires, built one step at a time."
        ),
        height=96,
    ),
]
