import { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  if (typeof error === "string") {
    return error;
  }
  return "An error occurred";
}

export async function errorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply
) {
  // if (error.code == "FST_ERR_VALIDATION" && error.validation) {
  //   reply.status(StatusCodes.BAD_REQUEST).send({
  //     statusText: "BAD_REQUEST",
  //     statusCode: StatusCodes.BAD_REQUEST,
  //     data: {
  //       message: error.validation[0].message ?? "Validate error",
  //     },
  //   });
  // }

  // if (reply.sent || (reply.raw && reply.raw.headersSent) || config.DEBUG) {
  //   reply.status(StatusCodes.INTERNAL_SERVER_ERROR).send(error);
  // }

  // if (error instanceof CustomError) {
  //   reply.status(error.statusCode).send(error.serialize());
  // }

  reply.status(500).send({
    statusText: "INTERNAL_SERVER_ERROR",
    statusCode: 500,
    data: {
      message:
        getErrorMessage(error) ||
        "An error occurred. Please view logs for more details",
    },
  });
}
