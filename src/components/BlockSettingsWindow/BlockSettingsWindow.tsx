import type { BlockSettings } from "../../features/settings/settingsTypes";

type BlockSettingsWindowProps = {
  block: BlockSettings;
  onChangeName: (name: string) => void;
  onChangeType: (type: BlockSettings["type"]) => void | Promise<void>;
};

export function BlockSettingsDialog({ block, onChangeName, onChangeType }: BlockSettingsWindowProps) {
  return (
    <section className="block-settings-dialog" aria-label="Block settings">
      <header className="block-settings-dialog-header">
        <div className="block-settings-dialog-title">
          <strong>Block settings</strong>
          <span>{block.id}</span>
        </div>
      </header>

      <div className="block-settings-dialog-body">
        <label>
          <span>Name</span>
          <input
            type="text"
            maxLength={3}
            value={block.name}
            placeholder="Name"
            onChange={(event) => onChangeName(event.currentTarget.value.slice(0, 3))}
          />
        </label>

        <label>
          <span>Type</span>
          <select value={block.type} onChange={(event) => void onChangeType(event.currentTarget.value as BlockSettings["type"])}>
            <option value="course">Course</option>
            <option value="placeholder">Placeholder</option>
          </select>
        </label>
      </div>
    </section>
  );
}
