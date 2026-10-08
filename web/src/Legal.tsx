import { XIcon } from "@phosphor-icons/react";
import { useRef } from "react";

export const TERMS = "https://www.hcompany.ai/terms-of-use";
export const PRIVACY = "https://www.hcompany.ai/privacy-policy";

/** A link that opens in a new tab. */
export const External = ({ href, children }: { href: string; children: string }) => (
  <a href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);

/** The home page's footer: the Terms, the Privacy Policy, and the credits the third-party assets require. */
export function LegalFooter() {
  const credits = useRef<HTMLDialogElement>(null);
  return (
    <footer className="legal">
      <External href={TERMS}>Terms</External>
      <span aria-hidden="true">·</span>
      <External href={PRIVACY}>Privacy</External>
      <span aria-hidden="true">·</span>
      <button aria-haspopup="dialog" onClick={() => credits.current?.showModal()}>
        Credits
      </button>
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
        </ul>
      </dialog>
    </footer>
  );
}
