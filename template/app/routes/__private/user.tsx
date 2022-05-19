import React from "react";
import getMeta from "@dvargas92495/app/utils/getMeta";
import UserDashboard from "@dvargas92495/app/components/UserDashboard";

const TABS = [{ id: "page" }, { id: "tab" }, { id: "hello" }];


const UserPage: React.FunctionComponent = () => {
  return <UserDashboard tabs={TABS} title={"GitLetter"} />;
};

export const meta = getMeta({
  title: "user",
});

export default UserPage;
