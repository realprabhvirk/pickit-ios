import { useEffect, useState } from 'preact/hooks';
import { popScreen } from '../app/nav';
import { offline, verifyOffline } from '../app/pwa';
import { checkCodecs, type CodecCheck } from '../engine/codecs';
import { NavScreen } from '../ui/NavScreen';
import { Row, Section } from '../ui/List';
import { formatBytes } from './DetailsSheet';
import './settings.css';

/** Proof, not promise: lists what's stored and runs every image encoder from the cache. */
export function Offline() {
  const [codecs, setCodecs] = useState<CodecCheck[] | null>(null);
  const [checking, setChecking] = useState(false);

  const run = async () => {
    setChecking(true);
    setCodecs(null);
    await verifyOffline();
    setCodecs(await checkCodecs());
    setChecking(false);
  };

  useEffect(() => {
    void run();
  }, []);

  const o = offline.value;
  const allCodecs = codecs?.every((c) => c.ok);

  return (
    <NavScreen title="Offline" onBack={popScreen} id="offline-status">
      <div class="list">
        <Section
          header="App Files"
          footer="To test it: turn on Airplane Mode, swipe PicKit away in the app switcher, then open it from your Home Screen."
        >
          <Row
            title="Status"
            detail={
              o.status === 'ready' ? (
                <span class="status-ok" id="offline-ready">
                  Ready Offline
                </span>
              ) : o.status === 'incomplete' ? (
                <span class="status-bad">Incomplete</span>
              ) : o.status === 'unsupported' ? (
                'Not Available'
              ) : (
                'Downloading…'
              )
            }
          />
          {o.status === 'ready' && (
            <>
              <Row title="Files Stored" detail={<span class="t-num">{o.total}</span>} />
              <Row title="Image Encoders" detail={<span class="t-num">{o.wasm} WASM files</span>} />
              <Row title="Size" detail={<span class="t-num">{formatBytes(o.bytes)}</span>} />
            </>
          )}
          {o.status === 'incomplete' && <Row title="Missing" subtitle={o.missing.slice(0, 5).join(', ')} detail={<span class="t-num">{o.total - o.cached}</span>} />}
        </Section>

        <Section header="Image Encoders" footer="Each encoder is run on a small test image, straight from storage on this iPhone.">
          {(codecs ?? [{ name: 'JPEG' }, { name: 'PNG' }, { name: 'OxiPNG' }, { name: 'WebP' }]).map((c) => (
            <Row
              title={c.name}
              detail={
                !codecs ? (
                  'Testing…'
                ) : (c as CodecCheck).ok ? (
                  <span class="status-ok t-num">Works</span>
                ) : (
                  <span class="status-bad">Failed</span>
                )
              }
              subtitle={codecs && !(c as CodecCheck).ok ? (c as CodecCheck).error : undefined}
            />
          ))}
        </Section>

        <Section>
          <Row title={checking ? 'Checking…' : 'Check Again'} tinted onClick={checking ? undefined : () => void run()} id="offline-recheck" />
        </Section>
        {allCodecs && <div id="codecs-ok" hidden />}
      </div>
    </NavScreen>
  );
}
