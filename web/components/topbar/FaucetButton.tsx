"use client";

import {Droplet} from "lucide-react";

interface FaucetButtonProps {
  onOpen: () => void;
}

export function FaucetButton({onOpen}: FaucetButtonProps): React.ReactElement {
  return (
    <button type="button" className="wallet-btn" onClick={onOpen} aria-label="Open faucet">
      <Droplet size={12} />
      <span className="btn-lbl">FAUCET</span>
    </button>
  );
}
