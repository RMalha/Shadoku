import ShadokuApp from "./ShadokuApp";
import { onSignIn, onSession, onSignOut, onCheckUsername, onUsernameChange, onDeleteAccount, takeAuthError } from "./auth.js";

// Read once, before the first render: the address bar is cleaned of ?auth_error=… at the same time.
const AUTH_ERROR = takeAuthError();

export default function App() {
  return (
    <ShadokuApp
      onSignIn={onSignIn} onSession={onSession} onSignOut={onSignOut}
      onCheckUsername={onCheckUsername} onUsernameChange={onUsernameChange} onDeleteAccount={onDeleteAccount}
      authError={AUTH_ERROR}
    />
  );
}
