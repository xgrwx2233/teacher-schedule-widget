type SettingsPanelProps = {
  panelOpacity: number;
  onPanelOpacityChange: (value: number) => void;
};

export function SettingsPanel({ panelOpacity, onPanelOpacityChange }: SettingsPanelProps) {
  return (
    <div className="settings-panel">
      <label>
        <span>透明度</span>
        <input
          type="range"
          min="42"
          max="88"
          value={panelOpacity}
          onChange={(event) => onPanelOpacityChange(Number(event.currentTarget.value))}
        />
      </label>
    </div>
  );
}
