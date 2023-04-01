import { APIGatewayProxyEvent, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { CognitoIdentityServiceProvider } from 'aws-sdk';
import * as AWSXRay from 'aws-xray-sdk';
import fetch from 'node-fetch';
import { generateChallenge } from 'pkce-challenge';
import { URLSearchParams } from 'url';
import { v4 as uuid } from 'uuid';

import { logger } from '../utilities/observability';

// Constants
export const COGNITO_BASE_URL = process.env.COGNITO_BASE_URL ?? '';
export const AUTHORIZATION_ENDPOINT = `${COGNITO_BASE_URL}/oauth2/authorize`;
export const TOKEN_ENDPOINT = `${COGNITO_BASE_URL}/oauth2/token`;
export const COGNITO_LOGOUT_URL = `${COGNITO_BASE_URL}/logout`;
export const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '';

// Cognito client
const cognito = AWSXRay.captureAWSClient(new CognitoIdentityServiceProvider());

// Response from Cognito token endpoint
interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface User extends CognitoIdentityServiceProvider.GetUserResponse {
  userId?: string;
}

// Get user details from cognito using a JWT access token
export const getUserDetailsViaAccessToken = async (token: string): Promise<User | undefined> => {
  try {
    // Use access token to fetch user info
    const user = (await cognito.getUser({ AccessToken: token }).promise()) as User;

    // extract email address and set as user id
    user.userId = user.UserAttributes.find((x) => x.Name === 'email')?.Value;
    return user;
  } catch (err) {
    logger.error(`Error validating access token: ${err}`);
    return undefined;
  }
};

export interface DownloadEvent {
  filepath: string;
  userId: string;
  requestContext: {
    requestId: string;
    domainName: string;
  };
}

// TODO: pass API url as environment variable to lambda so below 2 functions are not required
export const getRedirectUri = (event: APIGatewayProxyEvent | DownloadEvent): string => {
  // use current domain
  return `https://${event.requestContext.domainName}/prod/auth_callback`;
};

export const getLogoutUri = (event: APIGatewayProxyEvent | DownloadEvent): string => {
  // use current domain
  return `https://${event.requestContext.domainName}/prod/logout_callback`;
};

// Read cookie value from event headers
export const getCookie = (
  event: APIGatewayProxyEvent | APIGatewayRequestAuthorizerEvent,
  cookieName: string,
): string | undefined => {
  const cookies = event.headers?.cookie;
  if (cookies) {
    const cookieArray = cookies.split(';');
    const myCookie = cookieArray.find((cookie) => cookie.trim().startsWith(`${cookieName}=`));
    if (myCookie) {
      const cookieValue = myCookie.split('=')[1];
      return cookieValue;
    }
  }
  return undefined;
};

// Generate Cognito login url
export const generateAuthUrl = (redirectUri: string, filepath?: string) => {
  // Generate a unique PKCE code verifier and challenge
  const codeVerifier = uuid();
  const codeChallenge = generateChallenge(codeVerifier);

  // Construct the authorization URL with the necessary parameters
  const params = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'aws.cognito.signin.user.admin',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: filepath ?? '',
  };

  const queryString = new URLSearchParams(params).toString();
  const authUrl = `${AUTHORIZATION_ENDPOINT}?${queryString}`;

  return {
    authUrl,
    codeVerifier,
  };
};

// Exchange oAuth2 auth code for access token
export async function exchangeToken(code: string, codeVerifier: string, redirectUri: string): Promise<TokenResponse> {
  const params = {
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    code,
  };

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });

  const data = (await response.json()) as TokenResponse;

  // Return the access token
  return data;
}
