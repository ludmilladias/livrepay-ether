/**
 * Login SRP (USER_SRP_AUTH) contra um Cognito User Pool cujo App Client tem
 * client secret — caso do App Client da Ether usado para login de pessoas
 * (`USER_PASSWORD_AUTH` está desabilitado nele; só SRP funciona).
 *
 * `amazon-cognito-identity-js` não sabe lidar com App Client com secret (é
 * pensado para uso em browser, onde um secret nunca deveria existir). O
 * workaround padrão — usado aqui — é deixar a biblioteca fazer toda a
 * matemática de SRP (grupo, chave de sessão, assinatura) e interceptar as
 * duas chamadas de rede (`InitiateAuth`, `RespondToAuthChallenge`) para
 * injetar o `SECRET_HASH` que o Cognito exige quando o client tem secret.
 *
 * SECRET_HASH = base64(HMAC-SHA256(key = clientSecret, msg = username + clientId))
 *
 * Detalhe que costuma passar despercebido: no `RespondToAuthChallenge`, o
 * `username` a usar no SECRET_HASH não é o que o chamador digitou — é o
 * `USER_ID_FOR_SRP` que o Cognito devolve no `InitiateAuth` (pode divergir,
 * ex. por normalização de e-mail). A biblioteca já reescreve
 * `ChallengeResponses.USERNAME` para esse valor antes de disparar o request;
 * por isso lemos o username do próprio payload interceptado, nunca do
 * argumento original da função.
 *
 * Nenhuma credencial (senha, secret, hash, token) é logada por este módulo.
 */
import crypto from "node:crypto";
import { CognitoUserPool, CognitoUser, AuthenticationDetails } from "amazon-cognito-identity-js";

function secretHash(username, clientId, clientSecret) {
  return crypto.createHmac("sha256", clientSecret).update(username + clientId).digest("base64");
}

/**
 * @param {object} params
 * @param {string} params.userPoolId — ex: "us-east-2_BcbqtNJM3"
 * @param {string} params.clientId — App Client ID
 * @param {string} params.clientSecret — App Client secret (necessário para SECRET_HASH)
 * @param {string} params.username — e-mail/usuário do admin
 * @param {string} params.password
 * @param {() => Promise<string>} [params.getTotpCode] — chamado quando o Cognito exige
 *   SOFTWARE_TOKEN_MFA; deve devolver os 6 dígitos do TOTP. Este módulo não sabe de onde o
 *   código vem (prompt, argumento de CLI etc.) — isso é responsabilidade de quem chama.
 *   Sem esse callback, um desafio TOTP termina em erro explícito.
 * @returns {Promise<{ idToken: string, accessToken: string, refreshToken: string }>}
 */
export function loginWithSrp({ userPoolId, clientId, clientSecret, username, password, getTotpCode }) {
  if (!userPoolId || !clientId || !clientSecret) {
    throw new Error("userPoolId, clientId e clientSecret são obrigatórios para o login SRP");
  }

  const pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
  const user = new CognitoUser({ Username: username, Pool: pool });

  // Intercepta as duas únicas operações de rede que o fluxo SRP dispara e
  // injeta SECRET_HASH sem alterar o resto do payload que a lib monta.
  const originalRequest = pool.client.request.bind(pool.client);
  pool.client.request = (operation, params, callback) => {
    const patched = { ...params };

    if (patched.AuthParameters) {
      const u = patched.AuthParameters.USERNAME ?? username;
      patched.AuthParameters = { ...patched.AuthParameters, SECRET_HASH: secretHash(u, clientId, clientSecret) };
    }
    if (patched.ChallengeResponses) {
      const u = patched.ChallengeResponses.USERNAME ?? username;
      patched.ChallengeResponses = {
        ...patched.ChallengeResponses,
        SECRET_HASH: secretHash(u, clientId, clientSecret),
      };
    }

    return originalRequest(operation, patched, callback);
  };

  const authDetails = new AuthenticationDetails({ Username: username, Password: password });

  const toSession = (session) => ({
    idToken: session.getIdToken().getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
  });

  return new Promise((resolve, reject) => {
    // Desafio SOFTWARE_TOKEN_MFA (TOTP). O código expira em ~30s, então é
    // buscado sob demanda via getTotpCode() em vez de pedido antecipadamente.
    // Uma única nova tentativa é permitida em caso de código errado/expirado
    // — o Cognito bloqueia a conta depois de várias falhas seguidas, e não
    // queremos arriscar travar o usuário admin por causa deste script.
    const MAX_TENTATIVAS_TOTP = 2;
    const responderTotp = async (tentativa) => {
      if (typeof getTotpCode !== "function") {
        reject(new Error("MFA_TOTP_REQUIRED: nenhum getTotpCode foi passado para loginWithSrp."));
        return;
      }

      let codigo;
      try {
        codigo = await getTotpCode();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      if (typeof codigo !== "string" || !/^\d{6}$/.test(codigo.trim())) {
        reject(new Error("Código TOTP inválido: precisa ser exatamente 6 dígitos numéricos."));
        return;
      }

      // Terceiro argumento obrigatório: sem ele a lib assume SMS_MFA e monta
      // SMS_MFA_CODE em vez de SOFTWARE_TOKEN_MFA_CODE — o Cognito rejeita.
      user.sendMFACode(
        codigo.trim(),
        {
          onSuccess: (session) => resolve(toSession(session)),
          onFailure: (err) => {
            const nome = err?.name || err?.code;
            const podeTentarDeNovo =
              (nome === "CodeMismatchException" || nome === "ExpiredCodeException") &&
              tentativa < MAX_TENTATIVAS_TOTP;
            if (podeTentarDeNovo) {
              console.error(
                `Código TOTP rejeitado pelo Cognito (${nome}) — permitindo mais uma tentativa (${tentativa}/${MAX_TENTATIVAS_TOTP - 1} restante).`,
              );
              responderTotp(tentativa + 1);
              return;
            }
            reject(err instanceof Error ? err : new Error(err?.message ?? "Falha ao validar o código TOTP"));
          },
        },
        "SOFTWARE_TOKEN_MFA",
      );
    };

    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(toSession(session)),
      onFailure: (err) => {
        // err pode vir da lib com .message contendo o motivo (nunca inclui a
        // senha/secret — só o que o Cognito devolveu). Repassamos como está.
        reject(err instanceof Error ? err : new Error(err?.message ?? "Falha SRP desconhecida"));
      },
      newPasswordRequired: () => {
        reject(new Error("NEW_PASSWORD_REQUIRED: o Cognito exige troca de senha antes do login programático — não é algo que este script possa resolver sozinho."));
      },
      mfaRequired: () => {
        reject(new Error("MFA_REQUIRED (SMS_MFA): este script só implementa SOFTWARE_TOKEN_MFA (TOTP)."));
      },
      totpRequired: () => {
        responderTotp(1);
      },
    });
  });
}

/** Decodifica o payload de um JWT sem validar assinatura (uso: inspeção de claims não sensíveis). */
export function decodeJwtPayload(jwt) {
  const parts = jwt.split(".");
  if (parts.length < 2) throw new Error("Token mal formado");
  const payload = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(payload);
}
