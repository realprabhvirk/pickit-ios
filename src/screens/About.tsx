import { popScreen } from '../app/nav';
import { appVersion } from '../app/env';
import { NavScreen } from '../ui/NavScreen';
import { Row, Section } from '../ui/List';
import { LICENCES } from './licences';
import './settings.css';

export function About() {
  return (
    <NavScreen title="About" onBack={popScreen} id="about">
      <div class="list">
        <Section header="PicKit">
          <Row title="Version" detail={<span class="t-num">{appVersion}</span>} />
          <div class="about-block">
            <p>PicKit for iOS is the iPhone companion to PicKit for Windows. It’s open source under the MIT License.</p>
          </div>
        </Section>

        <Section header="Privacy">
          <div class="about-block">
            <p>Your photos never leave this iPhone. PicKit has no server, no accounts, no analytics and no tracking.</p>
            <p>
              After the first load it makes no network requests at all, and its Content Security Policy blocks connections to anywhere else, so
              this is enforced by your browser, not just promised.
            </p>
            <p>Exports are always new files. Your originals are never changed.</p>
          </div>
        </Section>

        <Section header="Third-Party Software">
          {LICENCES.map((l) => (
            <Row title={<span class="licence-name">{l.name}</span>} subtitle={`${l.use} · ${l.licence}`} />
          ))}
        </Section>

        <Section
          header="Design"
          footer="The icons are original drawings made for PicKit in the style of SF Symbols; SF Symbols themselves are licensed for Apple platforms only. Text uses your iPhone’s system font, which isn’t bundled."
        >
          <Row title="Icons" detail="Original" />
          <Row title="Font" detail="System" />
        </Section>
      </div>
    </NavScreen>
  );
}
