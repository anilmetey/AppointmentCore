using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using System.Security.Claims;
using AppointmentApi.Data;
using AppointmentApi.Models;

namespace AppointmentApi.Filters
{
    public class BranchAuthorizeAttribute : TypeFilterAttribute
    {
        public BranchAuthorizeAttribute() : base(typeof(BranchAuthorizeFilter))
        {
        }

        private class BranchAuthorizeFilter : IAsyncActionFilter
        {
            private readonly AppDbContext _dbContext;

            public BranchAuthorizeFilter(AppDbContext dbContext)
            {
                _dbContext = dbContext;
            }

            public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
            {
                var user = context.HttpContext.User;
                if (user == null || user.Identity == null || !user.Identity.IsAuthenticated)
                {
                    context.Result = new UnauthorizedResult();
                    return;
                }

                // If global admin, bypass tenant branch checks
                if (user.IsInRole(UserRole.Admin.ToString()))
                {
                    await next();
                    return;
                }

                // Find if there is a branch ID route parameter
                object? branchIdValue = null;
                if (context.RouteData.Values.TryGetValue("branchId", out var bId))
                {
                    branchIdValue = bId;
                }
                else if (context.RouteData.Values.TryGetValue("id", out var idVal))
                {
                    // Check if route template indicates this id refers to a branch
                    var template = context.ActionDescriptor.AttributeRouteInfo?.Template ?? string.Empty;
                    if (template.Contains("branches/{id}") || template.Contains("Branches/{id}"))
                    {
                        branchIdValue = idVal;
                    }
                }

                if (branchIdValue != null && int.TryParse(branchIdValue.ToString(), out int requestedBranchId))
                {
                    var userBranchClaim = user.FindFirst("branch_id")?.Value;
                    
                    if (string.IsNullOrEmpty(userBranchClaim) || !int.TryParse(userBranchClaim, out int userBranchId) || userBranchId != requestedBranchId)
                    {
                        // Tampering detected! Log the incident to SecurityLogs
                        var userIdStr = user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                        int? userId = int.TryParse(userIdStr, out int uid) ? uid : null;

                        var ipAddress = context.HttpContext.Connection.RemoteIpAddress?.ToString() ?? "Unknown";
                        var userAgent = context.HttpContext.Request.Headers["User-Agent"].ToString();
                        
                        var log = new SecurityLog
                        {
                            UserId = userId,
                            Action = "UNAUTHORIZED_BRANCH_ACCESS_ATTEMPT",
                            IpAddress = ipAddress,
                            UserAgent = userAgent,
                            Details = $"User attempted to access branch {requestedBranchId} but is assigned to branch {userBranchClaim ?? "None"}. Path: {context.HttpContext.Request.Path}",
                            CreatedAt = DateTime.UtcNow
                        };

                        _dbContext.SecurityLogs.Add(log);
                        await _dbContext.SaveChangesAsync();

                        context.Result = new ObjectResult(new { error = "Access to this branch resource is forbidden." })
                        {
                            StatusCode = StatusCodes.Status403Forbidden
                        };
                        return;
                    }
                }

                await next();
            }
        }
    }
}
