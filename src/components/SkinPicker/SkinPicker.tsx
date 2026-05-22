import type { SkinTheme } from "../../features/skins/types";

type SkinPickerProps = {
  themes: SkinTheme[];
  activeSkinId: string;
  onChange: (themeId: string) => void;
};

export function SkinPicker({ themes, activeSkinId, onChange }: SkinPickerProps) {
  return (
    <div className="skin-picker" aria-label="皮肤选择">
      {themes.map((theme) => (
        <button
          key={theme.id}
          className={theme.id === activeSkinId ? "skin-swatch is-active" : "skin-swatch"}
          type="button"
          title={theme.name}
          onClick={() => onChange(theme.id)}
        />
      ))}
    </div>
  );
}
