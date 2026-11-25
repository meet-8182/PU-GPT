import "./AIOrb.css";
import { Orb } from "@yogesharc/thinking-orbs";

export default function AIOrb() {
  return (
    <div className="ai-orb-loading">
      <Orb
        state="reasoning"
        size={100}
        speed={1.2}
        density={1.5}
        label="Searching Light House"
      />

      <p className="ai-orb-label">
        Searching Light House...
      </p>
    </div>
  );
}
