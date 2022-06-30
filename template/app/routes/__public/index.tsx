import React from "react";
import Landing, {
  Showcase,
  Splash,
} from "@dvargas92495/app/components/Landing";

const Home: React.FC = () => (
  <Landing>
    <Splash
      title={"Grab Users Attention With A Zingy Title"}
      subtitle={
        "Describe more what the application does with a subtitle underneath"
      }
      isWaitlist
    />
    <Showcase
      header="Show off some features with a showcase section!"
      showCards={[
        {
          title: "Feature 1",
          description: "Coming Soon...",
        },
        {
          title: "Feature 2",
          description: "Coming Soon...",
        },
        {
          title: "Feature 3",
          description: "Coming Soon...",
        },
      ]}
    />
  </Landing>
);

export const handle = Landing.handle;

export default Home;
