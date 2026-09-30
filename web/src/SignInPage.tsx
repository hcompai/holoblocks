import { GoogleLogoIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { signIn, signInError } from "./account";
import { Cube } from "./BlockLoader";

/** All a signed-out visitor sees: the block, and the way in with an H Company Google account. */
export function SignInPage() {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const back = (event: PageTransitionEvent) => event.persisted && setLeaving(false);
    window.addEventListener("pageshow", back);
    return () => window.removeEventListener("pageshow", back);
  }, []);
  return (
    <main className="sign-in-page">
      <div className="sign-in-cube">
        <div className="cube-float">
          <Cube />
        </div>
        <div className="cube-shadow" />
      </div>
      <h1>Blockyard</h1>
      <p className="sign-in-lead">Describe a structure. Holo builds it, block by block.</p>
      <button
        className="sign-in-google"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void signIn();
        }}
      >
        <GoogleLogoIcon size={18} weight="bold" />
        {leaving ? "Opening Google…" : "Continue with Google"}
      </button>
      {signInError && (
        <p className="sign-in-error" role="alert">
          {signInError}
        </p>
      )}
      <p className="sign-in-fine">For H Company accounts</p>
    </main>
  );
}
