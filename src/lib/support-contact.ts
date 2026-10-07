/**
 * Canal de atendimento do LivrePay: ÚNICO ponto do código que o define.
 *
 * PENDENTE DE DEFINIÇÃO (dona do produto): ainda não existe canal de suporte
 * oficial. Nenhum e-mail, telefone ou link foi inventado aqui. Para publicar o
 * canal, preencha `email`, `phone` e/ou `url` abaixo (e `hours`, se houver
 * horário de atendimento): as telas passam a mostrá-lo sozinhas, sem outra
 * alteração de código. Enquanto os três estiverem `null`, as telas dizem
 * honestamente que o canal ainda não foi divulgado.
 */
export interface SupportContact {
  /** E-mail de atendimento (PENDENTE). */
  email: string | null;
  /** Telefone/WhatsApp em texto livre para exibição (PENDENTE). */
  phone: string | null;
  /** Página ou formulário de atendimento, com https:// (PENDENTE). */
  url: string | null;
  /** Horário de atendimento, em texto livre (PENDENTE). */
  hours: string | null;
}

export const SUPPORT_CONTACT: SupportContact = {
  email: null, // PENDENTE DE DEFINIÇÃO
  phone: null, // PENDENTE DE DEFINIÇÃO
  url: null, // PENDENTE DE DEFINIÇÃO
  hours: null, // PENDENTE DE DEFINIÇÃO
};

export function hasSupportChannel(contact: SupportContact = SUPPORT_CONTACT): boolean {
  return !!(contact.email || contact.phone || contact.url);
}
