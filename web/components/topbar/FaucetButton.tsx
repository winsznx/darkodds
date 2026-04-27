"use client";

import {Droplet} from "lucide-react";

interface FaucetButtonProps {
  onOpen: () => void;
}

export function FaucetButton({onOpen}: FaucetButtonProps): React.ReactElement {
  return (
    <button type="button" className="wallet-btn" onClick={onOpen}>
      <Droplet size={12} />
      FAUCET
    </button>
  );
}
