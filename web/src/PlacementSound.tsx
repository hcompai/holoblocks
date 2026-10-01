import { SpeakerHighIcon, SpeakerSlashIcon } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";
import { placementSoundEnabled, subscribePlacementSound, togglePlacementSound } from "./blockAudio";

export function PlacementSoundToggle() {
  const sound = useSyncExternalStore(subscribePlacementSound, placementSoundEnabled);
  return (
    <button
      className="icon-button placement-sound"
      onClick={togglePlacementSound}
      aria-pressed={sound}
      aria-label={sound ? "Mute block sounds" : "Enable block sounds"}
      title={sound ? "Mute block sounds" : "Enable block sounds"}
    >
      {sound ? <SpeakerHighIcon size={16} weight="bold" /> : <SpeakerSlashIcon size={16} weight="bold" />}
    </button>
  );
}
