// TODO - swap to aws-3
import AWS from "@aws-sdk/client-route-53-domains";
import type { Credentials } from "@aws-sdk/types";

const handler = ({
  from,
  to,
  DomainName,
  AccountId,
}: {
  AccountId: string;
  DomainName: string;
  from: Credentials;
  to: Credentials;
}) => {
  const domainsFrom = new AWS.Route53Domains({ credentials: from });
  const domainsTo = new AWS.Route53Domains({ credentials: to });
  return domainsFrom
    .transferDomainToAnotherAwsAccount({
      DomainName,
      AccountId,
    })
    .then((a) =>
      domainsTo.acceptDomainTransferFromAnotherAwsAccount({
        DomainName,
        Password: a.Password || "",
      })
    )
    .then((a) => console.log("success! Operation ID:", a.OperationId));
};

export default handler;
