import { EnvelopeSimpleIcon, GoogleLogoIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { signIn, signInError, signInOnPlatform } from "./account";
import { Cube } from "./BlockLoader";
import { External, PRIVACY, TERMS } from "./Legal";

/** The ways in with an H account, asked for when a signed-out visitor wants to build. */
export function SignInDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const google = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [onPlatform, setOnPlatform] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    google.current?.focus();
    const back = (event: PageTransitionEvent) => event.persisted && setLeaving(false);
    window.addEventListener("pageshow", back);
    return () => window.removeEventListener("pageshow", back);
  }, []);
  return (
    <dialog className="sign-in-dialog" ref={dialog} aria-labelledby="sign-in-title" onClose={onClose}>
      <button className="icon-button sign-in-close" aria-label="Close" onClick={() => dialog.current?.close()}>
        <XIcon size={20} />
      </button>
      <div className="sign-in-cube">
        <div className="cube-float">
          <Cube />
        </div>
        <div className="cube-shadow" />
      </div>
      <h2 id="sign-in-title">Sign in to build</h2>
      <p className="sign-in-lead">Holo builds with your own key. Sign in to get one.</p>
      <button
        ref={google}
        className="sign-in-method sign-in-google"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void signIn();
        }}
      >
        <GoogleLogoIcon size={18} weight="bold" />
        {leaving ? "Opening Google…" : "Continue with Google"}
      </button>
      <button
        className="sign-in-method"
        disabled={leaving || onPlatform}
        onClick={() => {
          setOnPlatform(true);
          setBlocked(false);
          void signInOnPlatform().then((opened) => {
            setOnPlatform(false);
            setBlocked(!opened);
          });
        }}
      >
        <EnvelopeSimpleIcon size={18} weight="bold" />
        {onPlatform ? "Finish signing in in the popup…" : "Sign in with email"}
      </button>
      <p className="sign-in-terms">
        By signing in you agree to the <External href={TERMS}>Terms</External> and{" "}
        <External href={PRIVACY}>Privacy Policy</External>.
      </p>
      {(blocked || signInError) && (
        <p className="sign-in-error" role="alert">
          {blocked ? "Your browser blocked the sign-in popup: allow popups for this site and try again." : signInError}
        </p>
      )}
    </dialog>
  );
}
