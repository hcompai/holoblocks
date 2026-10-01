import { GoogleLogoIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { signIn, signInError } from "./account";
import { Cube } from "./BlockLoader";

/** The build a shared link opens, read back from the link preview tags api/preview.ts wrote; null on any other page. */
function sharedBuild(): { name: string; author: string | null; cover: string | null } | null {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("public") && !params.has("showcase")) return null;
  const tag = (key: string) => document.querySelector(`meta[property="${key}"]`)?.getAttribute("content") ?? "";
  const name = tag("og:title").match(/^(.+) · HoloBlocks$/)?.[1];
  if (!name) return null;
  return {
    name,
    author: tag("og:description").match(/, shared by (.+)$/)?.[1] ?? null,
    cover: tag("og:image:alt") === name ? tag("og:image") : null,
  };
}

/** All a signed-out visitor sees: the build a colleague shared, if any, and the way in with an H Company Google account. */
export function SignInPage() {
  const [leaving, setLeaving] = useState(false);
  const [shared] = useState(sharedBuild);
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => {
    const back = (event: PageTransitionEvent) => event.persisted && setLeaving(false);
    window.addEventListener("pageshow", back);
    return () => window.removeEventListener("pageshow", back);
  }, []);
  return (
    <main className="sign-in-page">
      {shared?.cover && !coverFailed ? (
        <img className="sign-in-cover" src={shared.cover} alt={shared.name} onError={() => setCoverFailed(true)} />
      ) : (
        <div className="sign-in-cube">
          <div className="cube-float">
            <Cube />
          </div>
          <div className="cube-shadow" />
        </div>
      )}
      {shared ? (
        <>
          <p className="sign-in-kicker">
            {shared.author ? `${shared.author} shared with you` : "From the HoloBlocks gallery"}
          </p>
          <h1>{shared.name}</h1>
          <p className="sign-in-lead">Sign in to open it in HoloBlocks.</p>
        </>
      ) : (
        <>
          <h1>HoloBlocks</h1>
          <p className="sign-in-lead">Describe a structure. Holo builds it, block by block.</p>
        </>
      )}
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
