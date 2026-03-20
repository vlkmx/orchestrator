import React from "react";

interface ButtonProps {
  label: string;
  onClick?: () => void;
}

export function Button({ label, onClick }: ButtonProps): JSX.Element {
  return (
    <button type="button" onClick={onClick} style={{ padding: "8px 12px", borderRadius: 8 }}>
      {label}
    </button>
  );
}
