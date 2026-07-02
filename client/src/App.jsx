import { useEffect, useState } from 'react';
import Billing from './components/Billing.jsx';
import Products from './components/Products.jsx';
import History from './components/History.jsx';
import Settings from './components/Settings.jsx';
import { api } from './api.js';

const TABS = [
  ['billing', 'New Bill'],
  ['products', 'Products'],
  ['history', 'History'],
  ['settings', 'Settings'],
];

export default function App() {
  const [tab, setTab] = useState('billing');
  const [settings, setSettings] = useState(null);

  const loadSettings = () => api.getSettings().then(setSettings).catch(() => {});
  useEffect(() => { loadSettings(); }, []);

  return (
    <div className="app">
      <header className="topbar no-print">
        <h1>🧾 {settings?.store_name || 'Billing App'}</h1>
        <nav>
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {tab === 'billing' && <Billing settings={settings} />}
        {tab === 'products' && <Products />}
        {tab === 'history' && <History settings={settings} />}
        {tab === 'settings' && <Settings settings={settings} onSaved={loadSettings} />}
      </main>
    </div>
  );
}
