// Adapted from Memos (MIT) — https://github.com/usememos/memos
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  idPrefix: string;
  username: string;
  password: string;
  readOnly?: boolean;
  onUsernameChange: (username: string) => void;
  onPasswordChange: (password: string) => void;
}

// Username + password field pair used by the sign-in form.
const CredentialFields = ({ idPrefix, username, password, readOnly, onUsernameChange, onPasswordChange }: Props) => {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-username`}>Username</Label>
        <Input
          id={`${idPrefix}-username`}
          type="text"
          readOnly={readOnly}
          placeholder="Username"
          value={username}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => onUsernameChange(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-password`}>Password</Label>
        <Input
          id={`${idPrefix}-password`}
          type="password"
          readOnly={readOnly}
          placeholder="Password"
          value={password}
          autoComplete="current-password"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => onPasswordChange(e.target.value)}
          required
        />
      </div>
    </>
  );
};

export default CredentialFields;
