import { PLAN_OUT_FILE } from "./common";
import getMysqlConnection from "./mysql";
import fs from "fs";
import migrate from "./migrate";
import axios from "axios";
import path from "path";

const apply = async ({
  domain = path.basename(process.cwd()),
  workspace = domain.replace(/\./g, "-"),
  organization = process.env.TERRAFORM_ORGANIZATION,
}: {
  domain?: string;
  workspace?: string;
  organization?: string;
} = {}): Promise<number> => {
  const tfOpts = {
    headers: {
      Authorization: `Bearer ${process.env.TERRAFORM_CLOUD_TOKEN}`,
      "Content-Type": "application/vnd.api+json",
    },
  };
  const getWorkspaceByOrg = (org: string) =>
    axios
      .post<{ data: { id: string } }>(
        `https://app.terraform.io/api/v2/organizations/${org}/workspaces`,
        {
          data: {
            type: "workspaces",
            attributes: {
              name: workspace,
            },
          },
        },
        tfOpts
      )
      .then((r) => r.data.data.id)
      .catch(() => "");
  const workspaceId = await (organization
    ? getWorkspaceByOrg(organization)
    : axios
        .get<{ data: { id: string }[] }>(
          `https://app.terraform.io/api/v2/organizations`,
          tfOpts
        )
        .then((r) =>
          Promise.all(r.data.data.map((d) => getWorkspaceByOrg(d.id)))
        )
        .then((ids) => ids.find((i) => !!i)));
  if (workspaceId) {
    const result = await axios
      .get<{ data: { id: string; status: string; "created-at": string }[] }>(
        `https://app.terraform.io/api/v2/workspaces/${workspaceId}/runs`,
        tfOpts
      )
      .catch((e) => Promise.reject(`Failed to get workspaces: ${e.message}`))
      .then((r) => {
        console.log(
          "Runs found:",
          JSON.stringify(
            r.data.data.map((d) => ({
              id: d.id,
              date: d["created-at"],
              status: d.status,
            })),
            null,
            4
          )
        );
        const runId = r.data.data[0].id;
        return axios
          .post(
            `https://app.terraform.io/api/v2/runs/${runId}/actions/apply`,
            {
              comment: `Fired from fuego at ${new Date().toJSON()}`,
            },
            tfOpts
          )
          .then(
            () =>
              `Applied Terraform run: https://app.terraform.io/app/${organization}/workspaces/${workspace}/runs/${runId}`
          )
          .catch((e) => Promise.reject(`Failed to apply run: ${e.message}`));
      })
      .catch((e) => e);
    console.log("Finished applying terraform run:", result);
  } else {
    console.log(
      "Could not find a workspace to apply a run from. Go apply it manually"
    );
  }

  const queries = fs
    .readFileSync(PLAN_OUT_FILE)
    .toString()
    .split(";\n\n")
    .filter((s) => !!s);
  return queries.length
    ? getMysqlConnection().then(async (cxn) => {
        await queries
          .map((q, i, a) => async () => {
            console.log(`Running query ${i + 1} of ${a.length}:`);
            console.log(">", q);
            await cxn.execute(q);
            console.log("Done!");
            console.log("");
          })
          .reduce((p, c) => p.then(c), Promise.resolve());
        return migrate({ cxn: cxn.connection }).then((code) => {
          cxn.destroy();
          return code;
        });
      })
    : Promise.resolve().then(() => {
        console.log("No queries to run!");
        return 0;
      });
};

export default apply;
