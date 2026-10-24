import { useState } from 'react';
import { CopyBox } from './ui.jsx';

export default function CodeTabs({ tabs }) {
  const [i, setI] = useState(0);
  const [label, code, lang] = tabs[Math.min(i, tabs.length - 1)];
  return (
    <div className="codetabs">
      <div className="code-tabs" role="tablist">
        {tabs.map(([l], k) => (
          <button key={l} type="button" role="tab" aria-selected={k === i} onClick={() => setI(k)}>
            {l}
          </button>
        ))}
      </div>
      <CopyBox code={code} lang={lang} label={label} />
    </div>
  );
}
