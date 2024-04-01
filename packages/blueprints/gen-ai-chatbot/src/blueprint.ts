import { EnvironmentDefinition, AccountConnection, Role, Environment } from '@amazon-codecatalyst/blueprint-component.environments';
import { Issue } from '@amazon-codecatalyst/blueprint-component.issues';
import { SourceRepository, SourceFile, SubstitionAsset } from '@amazon-codecatalyst/blueprint-component.source-repositories';
import { DEFAULT_DELETE_RESOURCE_WORKFLOW_NAME, Workflow, WorkflowBuilder, emptyWorkflow } from '@amazon-codecatalyst/blueprint-component.workflows';
import {
  BlueprintSynthesisErrorTypes,
  Blueprint as ParentBlueprint,
  Options as ParentOptions,
  Region,
} from '@amazon-codecatalyst/blueprints.blueprint';
import ipaddr from 'ipaddr.js';
import semver from 'semver';
import defaults from './defaults.json';
import { getDeploymentWorkflow } from './workflows';

/**
 * This is the 'Options' interface. The 'Options' interface is interpreted by the wizard to dynamically generate a selection UI.
 * 1. It MUST be called 'Options' in order to be interpreted by the wizard
 * 2. This is how you control the fields that show up on a wizard selection panel. Keeping this small leads to a better user experience.
 * 3. You can use JSDOCs and annotations such as: '?', @advanced, @hidden, @display - textarea, etc. to control how the wizard displays certain fields.
 * 4. All required members of 'Options' must be defined in 'defaults.json' to synth your blueprint locally
 * 5. The 'Options' member values defined in 'defaults.json' will be used to populate the wizard selection panel with default values
 */
export interface Options extends ParentOptions {
  /**
   * This is the environment associated with your main Git branch.
   * @displayName Environment
   */
  environment: EnvironmentDefinition<{
    /**
     * @displayName AWS account
     */
    connection: AccountConnection<{
      /**
       * This is the role that will be used to deploy the application. It should have access to deploy all of your resources. See the Readme for more information.
       * @displayName Deploy role
       * @inlinePolicy ./inline-policy-deploy.json
       * @trustPolicy ./trust-policy.json
       */
      deployRole: Role<['codecatalyst*']>;
    }>;
  }>;

  /**
   * Allow unauthenticated users to self-register their own accounts to login to the chatbot.
   *
   *  - If **enabled**: this will allow anyone to sign up with an account and access your chatbot.
   *  - If **disabled**: you must register each users via cognito yourself.
   * @displayName Self registration
   */
  enableSelfRegistration: 'Enabled' | 'Disabled';

  /**
   * This is an intentionally hidden field that determines if the cleanup workflow will be generated as commented out.
   * This will be set to true during blueprint health assessment run for cleanup workflow to run as expected.
   * @hidden true
   */
  uncommentCleanupWorkflow?: boolean;

  /**
   * The name of the temporary S3 bucket used in the cleanup workflow. This option is hidden and will be set by the wizard
   * to a default bucket prefix followed by wizard generated entropy. This option allows subsequent resynthesis to
   * generate the cleanup workflow using the same random bucket name as was generated by the original synthesis.
   * @validationRegex /^[-.a-zA-Z0-9]{3,63}$/
   * @validationMessage Must contain only alphanumeric characters, periods (.), dashes (-) and be between 3 and 63 characters in length.
   * @defaultEntropy 32
   * @hidden true
   */
  cleanupWorkflowTemplateBucketName?: string;

  /**
   * The name of the temporary S3 bucket used in the cleanup workflow. This option is hidden and will be set by the wizard
   * to a default bucket prefix followed by wizard generated entropy. This option allows subsequent resynthesis to
   * generate the cleanup workflow using the same random bucket name as was generated by the original synthesis.
   *
   * Since the WAF is always deployed as a separate stack, this bucket is unique from `cleanupWorkflowTemplateBucketName`.
   * @validationRegex /^[-.a-zA-Z0-9]{3,63}$/
   * @validationMessage Must contain only alphanumeric characters, periods (.), dashes (-) and be between 3 and 63 characters in length.
   * @defaultEntropy 32
   * @hidden true
   */
  cleanupWafWorkflowTemplateBucketName?: string;

  /**
   * These are additional configurations used to fine tune code.
   * @displayName Additional Configurations
   * @collapsed true
   */
  code: {
    /**
     * The backend resources for this blueprint can be deployed to any AWS region, however Amazon Bedrock models are only
     * available in regions where Amazon Bedrock is deployed.
     *
     * Note that this blueprint will *always* deploy a WAF stack in Cloudformation to the `us-east-1` region due to
     * [Cloudfront restrictions](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-wafv2-webacl.html).
     * @displayName Deployment region
     */
    region: Region<['*']>;

    /**
     * AWS Regions for Amazon Bedrock access are limited to the Regions where [Amazon Bedrock is available](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-regions.html).
     * @displayName Amazon Bedrock region
     */
    bedrockRegion: Region<['us-east-1', 'us-west-2']>;

    /**
     * What do you want to name the CloudFormation stack?
     * @validationRegex /^[a-zA-Z0-9-]+$/
     * @validationMessage Must contain only upper and lowercase letters, numbers and underscores
     * @defaultEntropy 8
     * @displayName AWS CloudFormation stack name
     */
    stackName: string;

    /**
     * Name of web ACL
     * @hidden true
     * @defaultEntropy 8
     */
    webAclName: string;

    /**
     * What do you want to name the S3 bucket where frontend assets will be stored?
     * @validationRegex /^[a-z0-9\-]{1,128}$/
     * @validationMessage Must contain only lowercase letters, numbers and hyphens (-)
     * @defaultEntropy 8
     * @displayName Amazon S3 Bucket name
     */
    bucketNamePrefix: string;

    /**
     * What should happen to the S3 bucket if you delete this CloudFormation stack?
     * @displayName S3 Bucket removal policy
     */
    bucketRemovalPolicy: 'Destroy' | 'Retain';

    /**
     * Select your Lambda development language
     * @displayName Runtime language
     * @hidden true
     */
    runtime: 'Python';

    /**
     * The name of the repository.
     * @displayName Repository name
     * @validationRegex /^[a-zA-Z0-9\-]{1,128}$/
     * @validationMessage Must contain only alphanumeric characters, hyphens (-)
     */
    repositoryName: string;

    /**
     * Allowed IPv4 address range. All addresses must be specified using Classless Inter-Domain Routing (CIDR) notation.
     * @displayName Allowed IPv4 addresses
     * @validationRegex /^([0-9]{1,3}\.){3}[0-9]{1,3}(\/([0-9]|[1-2][0-9]|3[0-2]))$/
     * @validationMessage Must be a valid IPv4 address in CIDR notation
     */
    allowedIpV4AddressRanges?: string[];

    /**
     * Allowed IPv6 address range. All addresses must be specified using Classless Inter-Domain Routing (CIDR) notation.
     * @displayName Allowed IPv6 addresses
     * @validationRegex /^s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]d|1dd|[1-9]?d)(.(25[0-5]|2[0-4]d|1dd|[1-9]?d)){3}))|:)))(%.+)?s*(\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))$/
     * @validationMessage Must be a valid IPv6 address in CIDR notation
     */
    allowedIpV6AddressRanges?: string[];

    /**
     * Enables user usage analysis via an admin console.
     * @displayName Usage Analysis
     */
    enableUsageAnalysis: 'Enabled' | 'Disabled';
  };
}

export class Blueprint extends ParentBlueprint {
  constructor(options_: Options) {
    super(options_);
    console.log(defaults);
    // helpful typecheck for defaults
    const typeCheck: Options = {
      outdir: this.outdir,
      ...defaults,
      enableSelfRegistration: defaults.enableSelfRegistration as Options['enableSelfRegistration'],
      // typescript needs some help disambiguating enums
      code: defaults.code as Options['code'],
    };
    const options = Object.assign(typeCheck, options_);
    console.log(options);

    this.validateOptions(options);

    // add a repository
    const repository = new SourceRepository(this, {
      title: options.code.repositoryName,
    });

    this.seedRepository(repository, options);

    new SourceFile(
      repository,
      'cdk.json',
      new SubstitionAsset('chatbot-genai-cdk/cdk.json').substitute({
        allowedIpV4AddressRanges: this.toCsv(options.code.allowedIpV4AddressRanges),
        allowedIpV6AddressRanges: this.toCsv(options.code.allowedIpV6AddressRanges),
        region: options.code.region,
        bedrockRegion: options.code.bedrockRegion,
        stackName: options.code.stackName,
        webAclName: options.code.webAclName,
        bucketRemovalPolicy: options.code.bucketRemovalPolicy.toUpperCase(),
        bucketNamePrefix: options.code.bucketNamePrefix,
        enableSelfRegistration: options.enableSelfRegistration === 'Enabled',
        enableUsageAnalysis: options.code.enableUsageAnalysis === 'Enabled',
      }),
    );

    if (options.enableSelfRegistration === 'Disabled') {
      new Issue(this, 'register-first-user', {
        title: 'Register your first chatbot user',
        content:
          'Log into the AWS account in which this chatbot is deployed. Navigate to cognito and then add a verified user in order to allow them to log in.',
      });
    }

    new Issue(this, 'personalize-your-bot', {
      title: 'Add custom data to re-train your bot',
      content: 'Log into your chatbot and use the bot console on the left to add custom data to the bot.',
    });

    const environment = new Environment(this, options.environment);
    const workflowBuilder = getDeploymentWorkflow(this, options, environment);

    // write a workflow to my repository
    new Workflow(this, repository, workflowBuilder.getDefinition());

    const claudeBehavior = this.claudeVersionCheck();
    if (claudeBehavior?.from2To3) {
      this.resynthPullRequest.description = [
        '> ⚠️',
        '> This pull request updates the project blueprint to use Claude 3 and is not backwards compatible with the previous version that uses Claude 2, due to changes in the DynamoDB table schema. Merging this pull request will update your blueprint to Claude 3 and will delete your conversation history.',
        '',
        this.resynthPullRequest.description,
      ].join('\n');
    } else if (claudeBehavior?.from3To2) {
      this.resynthPullRequest.description = [
        '> ⚠️',
        '> This pull request downgrades the project blueprint to use Claude 2 and is not backwards compatible with the previous version that uses Claude 3, due to changes in the DynamoDB table schema. Merging this pull request will downgrade your blueprint to Claude 2 and will delete your conversation history.',
        '',
        this.resynthPullRequest.description,
      ].join('\n');
    }

    {
      // create the cleanup workflow
      const cleanupWorkflow = new WorkflowBuilder(this, emptyWorkflow);
      cleanupWorkflow.setName(DEFAULT_DELETE_RESOURCE_WORKFLOW_NAME);
      const cleanupBackendActionName = `delete_${options.code.stackName}`.replace(/-/gi, '_');
      cleanupWorkflow
        .addCfnCleanupAction({
          actionName: cleanupBackendActionName,
          environment: {
            Name: options.environment.name || '<<PUT_YOUR_ENVIRONMENT_NAME_HERE>>',
            Connections: [
              {
                Name: options.environment.connection?.name || ' ',
                Role: options.environment.connection?.deployRole?.name || ' ',
              },
            ],
          },
          stackName: options.code.stackName,
          region: options.code.region as string,
          templateBucketName: options.cleanupWorkflowTemplateBucketName,
        })
        .addCfnCleanupAction({
          actionName: `delete_Waf${options.code.stackName}`,
          environment: {
            Name: options.environment.name || '<<PUT_YOUR_ENVIRONMENT_NAME_HERE>>',
            Connections: [
              {
                Name: options.environment.connection?.name || ' ',
                Role: options.environment.connection?.deployRole?.name || ' ',
              },
            ],
          },
          stackName: `Waf${options.code.stackName}`,
          region: 'us-east-1',
          templateBucketName: options.cleanupWafWorkflowTemplateBucketName,
          cloudFrontWebAclName: options.code.webAclName,
          dependsOn: [cleanupBackendActionName],
        });
      const additionalComments = [
        'The following workflow is intentionally disabled by the blueprint author to prevent project contributors from accidentally executing it.',
        'This workflow will attempt to delete all the deployed resources from the blueprint.',
        'The deletion action cannot be undone, please proceed at your own risk.',
        'To utilize it, please uncomment all the succeeding lines.',
      ];
      new Workflow(this, repository, cleanupWorkflow.definition, {
        additionalComments: options.uncommentCleanupWorkflow ? undefined : additionalComments,
        commented: !options.uncommentCleanupWorkflow,
      });
    }
  }

  /**
   * Checks if this is running in resynthesis mode and the model of Claude used by the blueprint is
   * being updated. The version of this blueprint that uses Claude 2 is not compatible with Claude 3
   * and would result in the customer losing conversation history.
   */
  private claudeVersionCheck() {
    // Instantations before or on this version use Claude 2
    const claude2MaxBlueprintVersion = '0.3.86';
    const currentInstantiation =
      this.context.project?.blueprint?.instantiationId &&
      this.context.project.blueprint.instantiations?.find(i => i.id === this.context.project.blueprint.instantiationId);
    return currentInstantiation
      ? {
        from2To3: semver.lte(currentInstantiation.versionId, claude2MaxBlueprintVersion),
        from3To2: semver.lt(claude2MaxBlueprintVersion, currentInstantiation.versionId),
      }
      : undefined;
  }

  private seedRepository(repository: SourceRepository, options: Options) {
    repository.copyStaticFiles({
      from: 'chatbot-genai-cdk',
    });
    repository.copyStaticFiles({
      from: 'chatbot-genai',
      substitute: {
        bedrockRegion: options.code.bedrockRegion as string,
      },
    });
    repository.copyStaticFiles({
      from: 'docs',
      to: 'docs',
      substitute: {
        bedrockRegion: options.code.bedrockRegion as string,
      },
    });
    repository.copyStaticFiles({
      from: 'chatbot-genai-components/frontend',
      to: 'frontend',
    });
    if (options.code.runtime === 'Python') {
      repository.copyStaticFiles({
        from: 'chatbot-genai-components/backend/python',
        to: 'backend',
      });
    }
  }

  private toCsv(values?: string[]) {
    return (values ?? []).map((value, i, row) => {
      if (i + 1 === row.length) {
        return { value };
      }
      return { value, comma: true };
    });
  }

  private validateOptions(options: Options) {
    options.code.allowedIpV4AddressRanges?.forEach(address => {
      try {
        const addr = ipaddr.IPv4.parseCIDR(address);
        if (addr[1] === 0) {
          this.throwSynthesisError({
            name: BlueprintSynthesisErrorTypes.ValidationError,
            message: 'The /0 CIDR range is not supported by AWS WAF.',
          });
        }
      } catch (err: unknown) {
        console.error(err);
        this.throwSynthesisError({
          name: BlueprintSynthesisErrorTypes.ValidationError,
          message: `${address} is not a valid IPv4 address.`,
        });
      }
    });

    options.code.allowedIpV6AddressRanges?.forEach(address => {
      try {
        const addr = ipaddr.IPv6.parseCIDR(address);
        if (addr[1] === 0) {
          this.throwSynthesisError({
            name: BlueprintSynthesisErrorTypes.ValidationError,
            message: 'The /0 CIDR range is not supported by AWS WAF.',
          });
        }
      } catch (err: unknown) {
        console.error(err);
        this.throwSynthesisError({
          name: BlueprintSynthesisErrorTypes.ValidationError,
          message: `${address} is not a valid IPv6 address.`,
        });
      }
    });
  }
}
