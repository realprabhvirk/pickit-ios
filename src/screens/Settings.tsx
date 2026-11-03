import { useEffect, useState } from 'preact/hooks';
import { popScreen, pushScreen } from '../app/nav';
import { offerUpdate, offline, persisted, requestPersistence, storageEstimate, updateWaiting, verifyOffline } from '../app/pwa';
import { showAlert, showToast } from '../app/overlays';
import { appVersion, isStandalone } from '../app/env';
import { enableMotionTilt, disableMotionTilt } from '../app/tilt';
import { openInstallHelp } from '../app/installHelp';
import { clearAllData } from '../store/db';
import { DEFAULT_SETTINGS, settings, TINTS, updateSettings, type ExportFormat } from '../store/settings';
import { NavScreen } from '../ui/NavScreen';
import { Row, Section } from '../ui/List';
import { Segmented } from '../ui/Segmented';
import { Slider } from '../ui/Slider';
import { Switch } from '../ui/Switch';
import { setHapticsEnabled, haptic } from '../ui/haptics';
import { formatBytes } from './DetailsSheet';
import './settings.css';

export function offlineDetail(): string {
  const o = offline.value;
  switch (o.status) {
    case 'ready':
      return 'Ready';
    case 'checking':
      return 'Checking…';
    case 'installing':
      return 'Downloading…';
    case 'incomplete':
      return `${o.cached} of ${o.total}`;
    default:
      return 'Not Available';
  }
}

export function Settings() {
  const s = settings.value;
  const [usage, setUsage] = useState<string>('…');

  const refreshUsage = () => storageEstimate().then((e) => setUsage(e ? formatBytes(e.usage) : 'Unknown'));

  useEffect(() => {
    void verifyOffline();
    void refreshUsage();
  }, []);

  const toggleMotion = async (on: boolean) => {
    if (on) {
      const ok = await enableMotionTilt();
      if (!ok) {
        showToast({ icon: 'motion', title: 'Motion access wasn’t allowed', subtitle: 'The highlight follows a fixed light instead.', duration: 3000 });
        return;
      }
    } else disableMotionTilt();
    updateSettings({ motionGlass: on });
  };

  const toggleHaptics = (on: boolean) => {
    setHapticsEnabled(on);
    updateSettings({ haptics: on });
    if (on) haptic();
  };

  const clearData = async () => {
    const r = await showAlert(
      'Clear Stored Data?',
      'This removes your settings, recent items and any saved session from this iPhone. Your photos aren’t affected. PicKit itself stays available offline.',
      [
        { label: 'Cancel', style: 'cancel' },
        { label: 'Clear', style: 'destructive' },
      ],
    );
    if (r !== 'Clear') return;
    await clearAllData();
    updateSettings({ ...DEFAULT_SETTINGS, installHelpSeen: true });
    setHapticsEnabled(false);
    disableMotionTilt();
    await refreshUsage();
    showToast({ icon: 'trash', title: 'Stored data cleared', duration: 2200 });
  };

  const persist = persisted.value;

  return (
    <NavScreen title="Settings" onBack={popScreen} id="settings">
      <div class="list">
        <Section header="Appearance" footer="Used for buttons, switches and highlights. Light and dark follow your iPhone.">
          <Row title="Tint Colour" icon="drop" iconColor="var(--tint)" stacked>
            <div class="tint-grid" role="radiogroup" aria-label="Tint colour">
              {TINTS.map((t) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={s.tint === t.id}
                  aria-label={t.name}
                  class="tint-swatch"
                  style={{ '--sw': `var(--${t.id})` }}
                  onClick={() => {
                    haptic();
                    updateSettings({ tint: t.id });
                  }}
                />
              ))}
            </div>
          </Row>
        </Section>

        <Section header="Export" footer="Starting points for new exports. You can change them each time. Exports are always new files.">
          <Row title="Format" icon="photo" iconColor="var(--blue)" stacked>
            <Segmented<ExportFormat>
              label="Default format"
              value={s.exportFormat}
              onChange={(v) => updateSettings({ exportFormat: v })}
              options={[
                { value: 'jpeg', label: 'JPEG' },
                { value: 'png', label: 'PNG' },
                { value: 'webp', label: 'WebP' },
              ]}
            />
          </Row>
          <Row title="Quality" icon="slider" iconColor="var(--indigo)" detail={<span class="t-num">{s.exportQuality}%</span>} stacked>
            <Slider
              value={s.exportQuality}
              min={10}
              max={100}
              onChange={(v) => updateSettings({ exportQuality: v })}
              label="Default quality"
              valueText={(v) => `${v} percent`}
            />
          </Row>
          <Row
            title="Remove Location & Camera Info"
            icon="location-slash"
            iconColor="var(--green)"
            accessory={<Switch checked={s.stripMetadata} onChange={(v) => updateSettings({ stripMetadata: v })} label="Remove location and camera info" />}
          />
        </Section>

        <Section header="Glass & Feedback" footer="Motion-reactive glass moves the highlights on buttons as you tilt your iPhone. Haptics use a trick that only some iOS versions honour.">
          <Row
            title="Motion-Reactive Glass"
            icon="motion"
            iconColor="var(--purple)"
            accessory={<Switch checked={s.motionGlass} onChange={(v) => void toggleMotion(v)} label="Motion-reactive glass" />}
          />
          <Row
            title="Haptics"
            subtitle="Experimental"
            icon="waveform"
            iconColor="var(--pink)"
            accessory={<Switch checked={s.haptics} onChange={toggleHaptics} label="Haptics, experimental" />}
          />
        </Section>

        <Section
          header="Offline & Storage"
          footer={
            isStandalone()
              ? 'Installed apps keep their storage. Clearing stored data doesn’t remove PicKit or your photos.'
              : 'In a Safari tab, iOS may clear stored data after 7 days without a visit. Add PicKit to your Home Screen to keep it.'
          }
        >
          <Row title="Ready Offline" icon="wifi-slash" iconColor="var(--orange)" detail={offlineDetail()} chevron onClick={() => pushScreen('offline')} id="row-offline" />
          <Row
            title="Keep Storage"
            icon="lock"
            iconColor="var(--gray)"
            detail={persist === true ? 'On' : persist === false ? 'Not Granted' : 'Not Available'}
            onClick={() => void requestPersistence()}
          />
          <Row title="Storage Used" icon="drive" iconColor="var(--gray)" detail={usage} />
          {updateWaiting.value && <Row title="Update Ready" icon="arrow-down-circle" iconColor="var(--blue)" tinted onClick={offerUpdate} chevron />}
          {!isStandalone() && <Row title="Add to Home Screen" icon="add-home" iconColor="var(--blue)" chevron onClick={openInstallHelp} />}
          <Row title="Clear Stored Data" destructive onClick={() => void clearData()} />
        </Section>

        <Section header="About">
          <Row title="Version" detail={<span class="t-num">{appVersion}</span>} />
          <Row title="Privacy & Licences" chevron onClick={() => pushScreen('about')} />
        </Section>
      </div>
    </NavScreen>
  );
}
