// TODO - swap to aws-3
import AWS from "aws-sdk";
import { CredentialsOptions } from "aws-sdk/lib/credentials";

const handler = ({
  from,
  to,
  DomainName,
  AccountId,
}: {
  AccountId: string;
  DomainName: string;
  from: CredentialsOptions;
  to: CredentialsOptions;
}) => {
  const domainsFrom = new AWS.Route53Domains({ credentials: from });
  const domainsTo = new AWS.Route53Domains({ credentials: to });
  return domainsFrom
    .transferDomainToAnotherAwsAccount({
      DomainName,
      AccountId,
    })
    .promise()
    .then((a) =>
      domainsTo
        .acceptDomainTransferFromAnotherAwsAccount({
          DomainName,
          Password: a.Password || "",
        })
        .promise()
    )
    .then((a) => console.log("success! Operation ID:", a.OperationId));
};

export default handler;
