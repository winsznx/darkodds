import "./_landing/landing.css";

import {AttestationTrail} from "./_landing/AttestationTrail";
import {FAQ} from "./_landing/FAQ";
import {Footer} from "./_landing/Footer";
import {Hero} from "./_landing/Hero";
import {HowItWorks} from "./_landing/HowItWorks";
import {LiveMarkets} from "./_landing/LiveMarkets";
import {SideBySide} from "./_landing/SideBySide";
import {StackStandards} from "./_landing/StackStandards";

export default function Home(): React.ReactElement {
  return (
    <>
      <Hero />
      <SideBySide />
      <HowItWorks />
      <StackStandards />
      <LiveMarkets />
      <AttestationTrail />
      <FAQ />
      <Footer />
    </>
  );
}
