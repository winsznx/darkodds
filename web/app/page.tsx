import "./_landing/landing.css";

import {Hero} from "./_landing/Hero";
import {HowItWorks} from "./_landing/HowItWorks";
import {SideBySide} from "./_landing/SideBySide";
import {StackStandards} from "./_landing/StackStandards";

export default function Home(): React.ReactElement {
  return (
    <>
      <Hero />
      <SideBySide />
      <HowItWorks />
      <StackStandards />
    </>
  );
}
