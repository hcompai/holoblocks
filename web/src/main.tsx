import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/fira-code";
import "@fontsource-variable/plus-jakarta-sans";
import { useAccount } from "./account";
import { BlockLoader } from "./BlockLoader";
import { SignInPage } from "./SignInPage";
import "./styles.css";

const App = lazy(() => import("./App"));

function Root() {
  const account = useAccount();
  if (!account) return <SignInPage />;
  return (
    <Suspense fallback={<BlockLoader label="Loading HoloBlocks…" />}>
      <App account={account} />
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
