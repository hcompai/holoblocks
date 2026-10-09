import { DiscordLogoIcon, GithubLogoIcon, LinkedinLogoIcon, XIcon, XLogoIcon } from "@phosphor-icons/react";
import { useRef } from "react";

export const TERMS = "https://www.hcompany.ai/terms-of-use";
export const PRIVACY = "https://www.hcompany.ai/privacy-policy";

/** A link that opens in a new tab. */
export const External = ({ href, children }: { href: string; children: string }) => (
  <a href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);

export const REPO = "https://github.com/hcompai/holoblocks";

const COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: "Demos",
    links: [
      ["HoloBricks", "https://bricks.hcompany.ai"],
      ["HoloBlocks", "https://blocks.hcompany.ai"],
      ["All demos", "https://build.hcompany.ai"],
      ["Source on GitHub", REPO],
    ],
  },
  {
    title: "Agents API",
    links: [
      ["Overview", "https://hcompany.ai/agents-api"],
      ["Docs", "https://hub.hcompany.ai/"],
      ["H Platform", "https://platform.hcompany.ai"],
      ["Pricing", "https://hcompany.ai/pricing"],
    ],
  },
  {
    title: "H Company",
    links: [
      ["Website", "https://hcompany.ai"],
      ["Holo4", "https://hcompany.ai/newsroom/holo4"],
      ["Research", "https://hcompany.ai/research"],
      ["Careers", "https://hcompany.ai/careers"],
      ["Contact us", "https://hcompany.ai/contact"],
    ],
  },
];

const SOCIAL = [
  { name: "X", href: "https://x.com/hcompany_ai", Icon: XLogoIcon },
  { name: "LinkedIn", href: "https://www.linkedin.com/company/h-company-ai", Icon: LinkedinLogoIcon },
  { name: "Discord", href: "https://discord.gg/gAWcDZgx4s", Icon: DiscordLogoIcon },
  { name: "GitHub", href: REPO, Icon: GithubLogoIcon },
];

/** The home page's footer: H Company, the demos, the Agents API, the legal pages and the credits. */
export function SiteFooter() {
  const credits = useRef<HTMLDialogElement>(null);
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-top">
          <div className="site-footer-brand">
            <a href="https://hcompany.ai" target="_blank" rel="noreferrer" aria-label="H Company">
              <svg viewBox="0 0 1035 600" fill="currentColor" aria-hidden="true">
                <circle cx="300" cy="300" r="300" />
                <rect x="838" y="195" width="54" height="220" />
                <rect x="838" y="282" width="197" height="45" />
                <rect x="981" y="195" width="54" height="220" />
              </svg>
            </a>
            <p>Built by H Company on the Agents API. Make your own app on top of Holo.</p>
            <div className="site-footer-social">
              {SOCIAL.map(({ name, href, Icon }) => (
                <a key={name} href={href} target="_blank" rel="noreferrer" aria-label={name}>
                  <Icon size={16} weight="fill" />
                </a>
              ))}
            </div>
          </div>
          <nav aria-label="Footer">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <h3>{column.title}</h3>
                <ul>
                  {column.links.map(([text, href]) => (
                    <li key={text}>
                      <External href={href}>{text}</External>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="site-footer-bottom">
          <p>© 2026 H Company. Founded in Paris, built around the world.</p>
          <ul>
            <li>
              <External href={PRIVACY}>Privacy Policy</External>
            </li>
            <li>
              <External href={TERMS}>Terms of Service</External>
            </li>
            <li>
              <External href="https://trust.hcompany.ai/">Trust Center</External>
            </li>
            <li>
              <button aria-haspopup="dialog" onClick={() => credits.current?.showModal()}>
                Credits
              </button>
            </li>
          </ul>
        </div>
      </div>
      <dialog ref={credits} className="credits-dialog" aria-labelledby="credits-title">
        <button className="icon-button sign-in-close" aria-label="Close" onClick={() => credits.current?.close()}>
          <XIcon size={20} />
        </button>
        <h2 id="credits-title">Credits</h2>
        <ul>
          <li>
            Block textures: <External href="https://faithfulpack.net/">Faithful 32x</External>, © Faithful Resource
            Pack, under the <External href="/textures/LICENSE.txt">Faithful License</External>.
          </li>
          <li>
            Fonts: <External href="https://github.com/tokotype/PlusJakartaSans">Plus Jakarta Sans</External> and{" "}
            <External href="https://github.com/tonsky/FiraCode">Fira Code</External>, under the{" "}
            <External href="https://openfontlicense.org/">SIL Open Font License 1.1</External>.
          </li>
          <li>
            Icons: <External href="https://phosphoricons.com/">Phosphor Icons</External>, under the MIT License.
          </li>
          <li>
            HoloBlocks is open source: <External href={REPO}>hcompai/holoblocks</External> on GitHub.
          </li>
        </ul>
      </dialog>
    </footer>
  );
}
