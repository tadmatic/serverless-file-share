import { APIGatewayProxyEvent, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import fetch from 'node-fetch';
import { generateChallenge } from 'pkce-challenge';
import { URLSearchParams } from 'url';
import { v4 as uuid } from 'uuid';

// Constants
const COGNITO_BASE_URL = process.env.COGNITO_BASE_URL ?? '';
const AUTHORIZATION_ENDPOINT = `${COGNITO_BASE_URL}/oauth2/authorize`;
const TOKEN_ENDPOINT = `${COGNITO_BASE_URL}/oauth2/token`;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '';

// Response from Cognito token endpoint
interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

// Generate redirect URI - https://{api-domain}/auth_callback
export const getRedirectUri = (event: APIGatewayProxyEvent): string => {
  // use current URL
  return `https://${event.requestContext.domainName}/prod/auth_callback`;
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
export const generateAuthUrl = (redirectUri: string) => {
  // Generate a unique PKCE code verifier and challenge
  const codeVerifier = uuid();
  const codeChallenge = generateChallenge(codeVerifier);

  // Generate a random state parameter
  // const state = uuid();

  // Construct the authorization URL with the necessary parameters
  const params = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'aws.cognito.signin.user.admin',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // state,
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
