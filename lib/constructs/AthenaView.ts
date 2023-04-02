import * as cdk from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import { Construct } from 'constructs';

interface AthenaViewColumn {
  name: string;
  type: string;
  comment?: string;
}

interface AthenaViewProps {
  viewName: string;
  databaseName: string;
  sqlQuery: string;
  ownerAccountId: string;
  columns: AthenaViewColumn[];
}

// Helper function to create 'presto' base64 encoded model
const createPrestoView = (query: string): string => {
  return `/* Presto View: ${new Buffer(query).toString('base64')} */`;
};

export class AthenaView extends Construct {
  constructor(scope: Construct, id: string, props: AthenaViewProps) {
    super(scope, id);

    const { viewName, databaseName, sqlQuery, columns, ownerAccountId } = props;

    // Presto JSON model (note: use varchar instead of string)
    const prestoObject = {
      originalSql: sqlQuery,
      catalog: 'awsdatactalog',
      schema: databaseName,
      columns: columns.map((c) => {
        return { ...c, type: c.type.replace('string', 'varchar') };
      }),
      owner: ownerAccountId,
      runAsInvoker: false,
      properties: {},
    };

    // Create view as a Glue Table with table type = 'VIRTUAL VIEW'
    new glue.CfnTable(this, 'AccessLogsDownloadReportView', {
      catalogId: cdk.Aws.ACCOUNT_ID,
      databaseName: databaseName,
      tableInput: {
        name: viewName,
        tableType: 'VIRTUAL_VIEW',
        viewExpandedText: '/* Presto View */',
        viewOriginalText: createPrestoView(JSON.stringify(prestoObject)),
        parameters: {
          presto_view: 'true',
          comment: 'Presto View',
        },
        partitionKeys: [],
        storageDescriptor: {
          columns,
          serdeInfo: {},
          location: '',
        },
      },
    });
  }
}
