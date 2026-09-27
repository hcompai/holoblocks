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
        site=(64, 96, 64),
    ),
    Showcase(
        key="bag-end",
        name="Bag End, Under the Hill",
        label="Showcase: Bag End",
        intro=(
            "Scripted showcase: Bilbo's round green door dug into a grassy hill under a great oak, with Bagshot Row, "
            "fields, hedgerows and sheep around it."
        ),
        site=(128, 100, 128),
    ),
]
